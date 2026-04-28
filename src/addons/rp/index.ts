import { ChatCompletionResponse, ChatMessage } from "../../types";
import { validatePreparedChatRequest } from "../../core/chat/default-handler";
import { ChatAddon } from "../../core/chat/types";
import { createOpenAIStreamTransformer } from "../../stream-transformer";
import {
	extractPreviousState,
	interpretState,
	parseInitialPrompt,
	parseRules,
	relationshipRulesContent,
	traitDefinitions
} from "./compiler";
import { buildInitialStatePrompt, buildOocAnalysisPrompt } from "./prompts";
import {
	createRpDebugId,
	extractStateBlockFromOutput,
	logRpDebug,
	logRpError,
	runCustomRpTurn,
	runNormalRpTurn,
	stripStateBlocksFromMessages
} from "./runtime";

const OOC_REGEX = /(?:\b|^|[\(\[\{])(?:ooc|оос)(?::|\b|[\)\]\}])/i;
const INITIAL_STATE_COMMAND_REGEX = /generate\s+<state>/i;

function getLastUserMessageText(messages: ChatMessage[]): string {
	const lastMessage = messages[messages.length - 1];
	if (!lastMessage || lastMessage.role !== "user") {
		return "";
	}

	if (typeof lastMessage.content === "string") {
		return lastMessage.content;
	}

	if (Array.isArray(lastMessage.content)) {
		return lastMessage.content
			.filter((part) => part.type === "text")
			.map((part) => part.text || "")
			.join(" ");
	}

	return "";
}

function buildInitialStateMessages(historyMessages: ChatMessage[], initialStateRequest: string): ChatMessage[] {
	return [
		...stripStateBlocksFromMessages(historyMessages),
		{
			role: "user",
			content: `<initial_state_request>\n${initialStateRequest.trim()}\n</initial_state_request>`
		}
	];
}

function buildChatCompletionResponse(model: string, content: string): ChatCompletionResponse {
	return {
		id: `chatcmpl-${crypto.randomUUID()}`,
		object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model,
		choices: [
			{
				index: 0,
				message: {
					role: "assistant",
					content
				},
				finish_reason: "stop"
			}
		]
	};
}

function buildChatCompletionOutput(request: { model: string; stream: boolean }, content: string): Response {
	if (!request.stream) {
		return Response.json(buildChatCompletionResponse(request.model, content));
	}

	const { readable, writable } = new TransformStream();
	const writer = writable.getWriter();
	const openAIStream = readable.pipeThrough(createOpenAIStreamTransformer(request.model));

	(async () => {
		await writer.write({ type: "text", data: content });
		await writer.close();
	})();

	return new Response(openAIStream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive"
		}
	});
}

export const rpAddon: ChatAddon = {
	name: "rp-addon",
	async handleRequest(request, context, tools) {
		validatePreparedChatRequest(request);

		if (request.rpMode === "my") {
			try {
				const services = await tools.createServices();
				const content = await runCustomRpTurn(services, request);
				return buildChatCompletionOutput(request, content);
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				return context.json({ error: errorMessage }, 500);
			}
		}

		if (request.rpMode !== "yaoshi") {
			return null;
		}

		const lastUserText = getLastUserMessageText(request.otherMessages).trim();
		if (INITIAL_STATE_COMMAND_REGEX.test(lastUserText)) {
			const debugId = createRpDebugId();
			const initialData = parseInitialPrompt(request.systemPrompt);
			const statePrompt = buildInitialStatePrompt(initialData, relationshipRulesContent, traitDefinitions);
			const stateMessages = request.cleanedMessages.slice(-10, -1);
			const initialStateMessages = buildInitialStateMessages(stateMessages, statePrompt.user);
			const initialStateOptions = {
				...request.generationOptions,
				includeReasoning: false,
				temperature: 0.3,
				top_p: 0.5,
				max_tokens: 2048,
				presence_penalty: 0,
				frequency_penalty: 0
			};
			delete initialStateOptions.response_format;
			delete initialStateOptions.stop;

			const { geminiClient } = await tools.createServices();
			let completion: Awaited<ReturnType<typeof geminiClient.getCompletion>>;
			try {
				completion = await geminiClient.getCompletion(
					request.model,
					statePrompt.system,
					initialStateMessages,
					initialStateOptions
				);
			} catch (error) {
				logRpError(debugId, "initial_state", "completion_error", error);
				throw error;
			}

			const stateBlock = extractStateBlockFromOutput(completion.content);
			if (!stateBlock) {
				logRpDebug(debugId, "initial_state", "parse_error", {
					message: "Initial state generation did not return a <state> block.",
					content: completion.content
				});
				return context.json({ error: "Initial state generation did not return a <state> block." }, 500);
			}

			return buildChatCompletionOutput(request, stateBlock);
		}

		const initialData = parseInitialPrompt(request.systemPrompt);
		if (lastUserText && OOC_REGEX.test(lastUserText)) {
			const rules = parseRules(relationshipRulesContent);
			const previousState = extractPreviousState(request.otherMessages);
			const interpretedState = interpretState(previousState, rules);
			const oocPrompt = buildOocAnalysisPrompt(interpretedState, initialData, {
				relationship_rules: relationshipRulesContent,
				traits_definitions: traitDefinitions
			});

			const oocMessages = [
				...stripStateBlocksFromMessages(request.cleanedMessages),
				{
					role: "user",
					content: oocPrompt.user
				}
			];
			const oocOptions = {
				...request.generationOptions,
				includeReasoning: request.includeReasoning,
				reasoning_effort: request.reasoningEffort,
				tools: request.tools,
				tool_choice: request.toolChoice,
				showReasoning: request.showReasoning
			};
			const debugId = createRpDebugId();

			try {
				const services = await tools.createServices();
				const completion = await services.geminiClient.getCompletion(request.model, oocPrompt.system, oocMessages, oocOptions);
				return buildChatCompletionOutput(request, completion.content);
			} catch (error) {
				logRpError(debugId, "ooc", "completion_error", error);
				const errorMessage = error instanceof Error ? error.message : String(error);
				return context.json({ error: errorMessage }, 500);
			}
		}

		try {
			const services = await tools.createServices();
			const content = await runNormalRpTurn(services, request);
			return buildChatCompletionOutput(request, content);
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			const status = errorMessage.includes("previous <state> block") ? 400 : 500;
			return context.json({ error: errorMessage }, status);
		}
	}
};
