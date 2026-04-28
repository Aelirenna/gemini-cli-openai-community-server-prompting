import type { ChatMessage } from "../../types";
import type { ChatGenerationOptions, PreparedChatCompletionRequest, ChatServices } from "../../core/chat/types";
import {
	buildCurrentSituation,
	extractPreviousState,
	extractPreviousStateBlock,
	interpretState,
	parseInitialPrompt,
	parseRules,
	relationshipRulesContent
} from "./compiler";
import {
	buildCustomPlannerPrompt,
	buildCustomProsePrompt,
	buildPlannerPrompt,
	buildProsePrompt,
	buildStateUpdatePrompt,
	getSceneMode
} from "./prompts";
import type { StagePrompt } from "./types";

const STATE_BLOCK_OUTPUT_REGEX = /<state>[\s\S]*?<\/state>/;
const STATE_BLOCK_GLOBAL_REGEX = /<state>[\s\S]*?<\/state>\s*/g;
const GM_REASONING_BLOCK_OUTPUT_REGEX = /<gm_reasoning>[\s\S]*?<\/gm_reasoning>/;
const GM_REASONING_BLOCK_GLOBAL_REGEX = /<gm_reasoning>[\s\S]*?<\/gm_reasoning>\s*/g;
const RP_DEBUG_LOG_CHUNK_SIZE = 8_000;

type StageGenerationOptions = ChatGenerationOptions & {
	includeReasoning?: boolean;
	showReasoning?: boolean;
};

export function createRpDebugId(): string {
	try {
		return crypto.randomUUID();
	} catch {
		return `rp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
	}
}

function safeSerializeForLog(payload: unknown): string {
	try {
		return JSON.stringify(payload, null, 2);
	} catch (error) {
		return String(error instanceof Error ? error.message : error);
	}
}

export function logRpDebug(debugId: string, stage: string, event: string, payload: unknown): void {
	const header = `[RP_DEBUG][${debugId}][${stage}][${event}]`;
	const serialized = safeSerializeForLog(payload);
	const chunkCount = Math.ceil(serialized.length / RP_DEBUG_LOG_CHUNK_SIZE) || 1;

	if (chunkCount === 1) {
		console.log(`${header} ${serialized}`);
		return;
	}

	console.log(`${header} length=${serialized.length} chunks=${chunkCount}`);
	for (let index = 0; index < chunkCount; index++) {
		const start = index * RP_DEBUG_LOG_CHUNK_SIZE;
		const chunk = serialized.slice(start, start + RP_DEBUG_LOG_CHUNK_SIZE);
		console.log(`${header}[${index + 1}/${chunkCount}] ${chunk}`);
	}
}

export function logRpError(debugId: string, stage: string, event: string, error: unknown): void {
	console.error(`[RP_DEBUG][${debugId}][${stage}][${event}]`, error);
}

export function extractStateBlockFromOutput(output: string): string | null {
	return output.match(STATE_BLOCK_OUTPUT_REGEX)?.[0] ?? null;
}

export function extractGmReasoningBlockFromOutput(output: string): string | null {
	return output.match(GM_REASONING_BLOCK_OUTPUT_REGEX)?.[0] ?? null;
}

function sanitizeStageGenerationOptions(
	request: PreparedChatCompletionRequest,
	overrides: StageGenerationOptions
): StageGenerationOptions {
	const baseOptions = { ...request.generationOptions };
	delete baseOptions.response_format;
	delete baseOptions.stop;
	return {
		...baseOptions,
		...overrides
	};
}

function stripStateBlocksFromText(text: string): string {
	return text.replace(STATE_BLOCK_GLOBAL_REGEX, "").trim();
}

function stripGmReasoningBlocksFromText(text: string): string {
	return text.replace(GM_REASONING_BLOCK_GLOBAL_REGEX, "").trim();
}

export function stripStateBlocksFromMessages(messages: ChatMessage[]): ChatMessage[] {
	return messages.map((message) => {
		if (typeof message.content === "string") {
			return {
				...message,
				content: stripStateBlocksFromText(message.content)
			};
		}

		if (Array.isArray(message.content)) {
			return {
				...message,
				content: message.content.map((part) =>
					part.type === "text" && part.text
						? {
								...part,
								text: stripStateBlocksFromText(part.text)
							}
						: part
				)
			};
		}

		return message;
	});
}

function appendExactStateBlock(prose: string, stateBlock: string): string {
	const cleanProse = stripStateBlocksFromText(prose);
	return cleanProse ? `${cleanProse}\n\n${stateBlock}` : stateBlock;
}

function parseStateBlock(stateBlock: string) {
	return extractPreviousState([{ role: "assistant", content: stateBlock }]);
}

export async function runStateUpdateStage(
	services: ChatServices,
	request: PreparedChatCompletionRequest,
	prompt: StagePrompt,
	debugId = createRpDebugId()
): Promise<string> {
	const messages = [
			...stripStateBlocksFromMessages(request.cleanedMessages),
			{
				role: "user",
				content: prompt.user
			}
		];
	const options = sanitizeStageGenerationOptions(request, {
			includeReasoning: false,
			temperature: 0.2,
			top_p: 0.5
		});

	let completion: Awaited<ReturnType<typeof services.geminiClient.getCompletion>>;
	try {
		completion = await services.geminiClient.getCompletion(request.model, prompt.system, messages, options);
	} catch (error) {
		logRpError(debugId, "state_update", "completion_error", error);
		throw error;
	}

	logRpDebug(debugId, "state_update", "model_output", {
		content: completion.content,
		reasoning: completion.reasoning,
		usage: completion.usage,
		tool_calls: completion.tool_calls
	});

	const stateBlock = extractStateBlockFromOutput(completion.content);
	if (!stateBlock) {
		logRpDebug(debugId, "state_update", "parse_error", {
			message: "State update step did not return a <state> block.",
			content: completion.content
		});
		throw new Error("State update step did not return a <state> block.");
	}

	return stateBlock;
}

export async function runStateUpdateForRequest(
	services: ChatServices,
	request: PreparedChatCompletionRequest,
	debugId = createRpDebugId()
): Promise<string> {
	const previousStateBlock = extractPreviousStateBlock(request.otherMessages);
	if (!previousStateBlock) {
		logRpDebug(debugId, "state_update", "missing_previous_state", {
			message: "State update requires a previous <state> block."
		});
		throw new Error("State update requires a previous <state> block.");
	}

	const initialData = parseInitialPrompt(request.systemPrompt);
	const rules = parseRules(relationshipRulesContent);
	const previousState = extractPreviousState(request.otherMessages);
	const previousSituation = buildCurrentSituation(interpretState(previousState, rules));
	const prompt = buildStateUpdatePrompt(initialData, previousStateBlock, previousState, previousSituation);

	return runStateUpdateStage(services, request, prompt, debugId);
}

export async function runPlannerStage(
	services: ChatServices,
	request: PreparedChatCompletionRequest,
	prompt: StagePrompt,
	debugId = createRpDebugId(),
	stageName = "planner"
): Promise<string> {
	const messages = [
			...stripStateBlocksFromMessages(request.cleanedMessages),
			{
				role: "user",
				content: prompt.user
			}
		];
	const options = sanitizeStageGenerationOptions(request, {
			includeReasoning: false,
			temperature: 1,
			top_p: 0.8
		});

	let completion: Awaited<ReturnType<typeof services.geminiClient.getCompletion>>;
	try {
		completion = await services.geminiClient.getCompletion(request.model, prompt.system, messages, options);
	} catch (error) {
		logRpError(debugId, stageName, "completion_error", error);
		throw error;
	}

	logRpDebug(debugId, stageName, "model_output", {
		content: completion.content,
		reasoning: completion.reasoning,
		usage: completion.usage,
		tool_calls: completion.tool_calls
	});

	const reasoningBlock = extractGmReasoningBlockFromOutput(completion.content);
	if (!reasoningBlock) {
		logRpDebug(debugId, stageName, "parse_error", {
			message: "Planner step did not return a <gm_reasoning> block.",
			content: completion.content
		});
		throw new Error("Planner step did not return a <gm_reasoning> block.");
	}

	return reasoningBlock;
}

export async function runProseStage(
	services: ChatServices,
	request: PreparedChatCompletionRequest,
	prompt: StagePrompt,
	stateBlock: string,
	debugId = createRpDebugId()
): Promise<string> {
	const messages = [
			...stripStateBlocksFromMessages(request.cleanedMessages),
			{
				role: "user",
				content: prompt.user
			}
		];
	const options = sanitizeStageGenerationOptions(request, {
			includeReasoning: false,
			temperature: request.generationOptions.temperature ?? 0.75,
			top_p: request.generationOptions.top_p ?? 0.95
		});

	let completion: Awaited<ReturnType<typeof services.geminiClient.getCompletion>>;
	try {
		completion = await services.geminiClient.getCompletion(request.model, prompt.system, messages, options);
	} catch (error) {
		logRpError(debugId, "prose", "completion_error", error);
		throw error;
	}

	const finalOutput = appendExactStateBlock(completion.content, stateBlock);
	return finalOutput;
}

export async function runCustomProseStage(
	services: ChatServices,
	request: PreparedChatCompletionRequest,
	prompt: StagePrompt,
	debugId = createRpDebugId()
): Promise<string> {
	const messages = [
			...stripStateBlocksFromMessages(request.cleanedMessages),
			{
				role: "user",
				content: prompt.user
			}
		];
	const options = sanitizeStageGenerationOptions(request, {
			includeReasoning: false,
			temperature: request.generationOptions.temperature ?? 0.75,
			top_p: request.generationOptions.top_p ?? 0.95
		});

	let completion: Awaited<ReturnType<typeof services.geminiClient.getCompletion>>;
	try {
		completion = await services.geminiClient.getCompletion(request.model, prompt.system, messages, options);
	} catch (error) {
		logRpError(debugId, "custom_prose", "completion_error", error);
		throw error;
	}

	const finalOutput = stripStateBlocksFromText(stripGmReasoningBlocksFromText(completion.content));
	return finalOutput;
}

export async function runCustomRpTurn(
	services: ChatServices,
	request: PreparedChatCompletionRequest
): Promise<string> {
	const debugId = createRpDebugId();
	logRpDebug(debugId, "custom_turn", "start", {
		model: request.model,
		messageCount: request.messages.length,
		cleanedMessageCount: request.cleanedMessages.length,
		rpMode: request.rpMode,
		stream: request.stream
	});

	const initialData = parseInitialPrompt(request.systemPrompt);
	const plannerPrompt = buildCustomPlannerPrompt(initialData);
	const reasoningBlock = await runPlannerStage(services, request, plannerPrompt, debugId, "custom_planner");
	const prosePrompt = buildCustomProsePrompt(initialData, reasoningBlock);
	const finalOutput = await runCustomProseStage(services, request, prosePrompt, debugId);

	logRpDebug(debugId, "custom_turn", "done", {
		outputLength: finalOutput.length
	});
	return finalOutput;
}

export async function runNormalRpTurn(
	services: ChatServices,
	request: PreparedChatCompletionRequest
): Promise<string> {
	const debugId = createRpDebugId();
	logRpDebug(debugId, "normal_turn", "start", {
		model: request.model,
		messageCount: request.messages.length,
		cleanedMessageCount: request.cleanedMessages.length,
		rpMode: request.rpMode,
		stream: request.stream
	});

	const stateBlock = await runStateUpdateForRequest(services, request, debugId);
	const initialData = parseInitialPrompt(request.systemPrompt);
	const rules = parseRules(relationshipRulesContent);
	const updatedState = parseStateBlock(stateBlock);
	const interpretedState = interpretState(updatedState, rules);
	const sceneMode = getSceneMode(interpretedState);
	const plannerPrompt = buildPlannerPrompt(initialData, interpretedState, sceneMode);
	const reasoningBlock = await runPlannerStage(services, request, plannerPrompt, debugId);
	const prosePrompt = buildProsePrompt(initialData, interpretedState, sceneMode, reasoningBlock);

	const finalOutput = await runProseStage(services, request, prosePrompt, stateBlock, debugId);
	logRpDebug(debugId, "normal_turn", "done", {
		outputLength: finalOutput.length
	});
	return finalOutput;
}
