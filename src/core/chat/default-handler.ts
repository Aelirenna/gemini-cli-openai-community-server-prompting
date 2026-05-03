import { AuthManager } from "../../auth";
import { GeminiApiClient } from "../../gemini-client";
import { createOpenAIStreamTransformer } from "../../stream-transformer";
import { ChatCompletionResponse, ChatCompletionRequest, ChatMessage, EffortLevel, Env, MessageContent, ModelInfo, RpMode } from "../../types";
import { DEFAULT_MODEL } from "../../models";
import { MIME_TYPE_MAP } from "../../constants";
import { isMediaTypeSupported, validateContent, validateModel } from "../../utils/validation";
import { Buffer } from "node:buffer";
import { ChatHttpError, ChatRouteContext, ChatServices, PreparedChatCompletionRequest } from "./types";

const REASONING_BLOCK_REGEX = /<(?:thinking|think)>[\s\S]*?<\/(?:thinking|think)>\s*/g;
const RP_MODES = new Set<RpMode>(["none", "my", "yaoshi"]);
const EFFORT_LEVELS = new Set<EffortLevel>(["none", "low", "medium", "high"]);
const DEFAULT_RP_GM_PLANNER_MODEL = "gemini-3-flash-preview";

function parseRpMode(value: string | undefined): RpMode | undefined {
	if (!value) {
		return undefined;
	}

	const normalized = value.toLowerCase();
	if (!RP_MODES.has(normalized as RpMode)) {
		throw new ChatHttpError(`Invalid rp_mode '${value}'. Expected one of: none, my, yaoshi.`, 400);
	}

	return normalized as RpMode;
}

function parseReasoningEffort(value: string | undefined): EffortLevel | undefined {
	if (!value) {
		return undefined;
	}

	const normalized = value.toLowerCase();
	if (!EFFORT_LEVELS.has(normalized as EffortLevel)) {
		throw new ChatHttpError(`Invalid REASONING_EFFORT '${value}'. Expected one of: none, low, medium, high.`, 400);
	}

	return normalized as EffortLevel;
}

function stripThinkingBlocks(messages: ChatCompletionRequest["messages"]): ChatCompletionRequest["messages"] {
	if (!messages) return [];
	return messages.map((msg) => {
		if (typeof msg.content === "string") {
			return { ...msg, content: msg.content.replace(REASONING_BLOCK_REGEX, "") };
		}
		return msg;
	});
}

export function buildPreparedChatRequest(body: ChatCompletionRequest, env: Env): PreparedChatCompletionRequest {
	const normalizedBody = { ...body };

	if (!normalizedBody.messages && (normalizedBody as { template?: string }).template) {
		console.log("Handling non-standard 'template' field for compatibility.");
		normalizedBody.messages = [{ role: "user", content: (normalizedBody as { template?: string }).template || "" }];
	}

	const model = normalizedBody.model || DEFAULT_MODEL;
	const messages = normalizedBody.messages || [];
	const stream = normalizedBody.stream !== false;

	let fullSystemPrompt = "";
	const otherMessages = messages.filter((msg) => {
		if (msg.role === "system") {
			if (typeof msg.content === "string") {
				fullSystemPrompt += msg.content + "\n";
			} else if (Array.isArray(msg.content)) {
				const textContent = msg.content
					.filter((part) => part.type === "text")
					.map((part) => part.text || "")
					.join(" ");
				fullSystemPrompt += textContent + "\n";
			}
			return false;
		}
		return true;
	});

	const effortRegex = /reasoning_effort=(low|medium|high|none)\s*/i;
	const showRegex = /show_reasoning=(true|false)\s*/i;
	const cleanRegex = /clean_context=(true|false)\s*/i;
	const rpModeRegex = /rp_mode=([a-z0-9_-]+)\s*/i;

	const promptEffortMatch = fullSystemPrompt.match(effortRegex);
	const promptShowMatch = fullSystemPrompt.match(showRegex);
	const promptCleanMatch = fullSystemPrompt.match(cleanRegex);
	const promptRpModeMatch = fullSystemPrompt.match(rpModeRegex);

	let effortFromPrompt: string | null = null;
	let showReasoning = true;
	let cleanContext = true;
	let rpModeFromPrompt: RpMode | undefined;

	if (promptEffortMatch) {
		effortFromPrompt = promptEffortMatch[1].toLowerCase();
		fullSystemPrompt = fullSystemPrompt.replace(effortRegex, "").trim();
		console.log(`Reasoning effort '${effortFromPrompt}' detected in system prompt.`);
	}

	if (promptShowMatch) {
		showReasoning = promptShowMatch[1].toLowerCase() === "true";
		fullSystemPrompt = fullSystemPrompt.replace(showRegex, "").trim();
		console.log(`Show reasoning set to '${showReasoning}' from system prompt.`);
	}

	if (promptCleanMatch) {
		cleanContext = promptCleanMatch[1].toLowerCase() === "true";
		fullSystemPrompt = fullSystemPrompt.replace(cleanRegex, "").trim();
		console.log(`Clean context set to '${cleanContext}' from system prompt.`);
	}

	if (promptRpModeMatch) {
		rpModeFromPrompt = parseRpMode(promptRpModeMatch[1]);
		fullSystemPrompt = fullSystemPrompt.replace(rpModeRegex, "").trim();
		console.log(`RP mode '${rpModeFromPrompt}' detected in system prompt.`);
	}

	const systemPrompt = fullSystemPrompt.trim();
	const reasoningEffort =
		(effortFromPrompt as EffortLevel | null) ||
		normalizedBody.reasoning_effort ||
		normalizedBody.extra_body?.reasoning_effort ||
		normalizedBody.model_params?.reasoning_effort ||
		parseReasoningEffort(env.REASONING_EFFORT);
	const rpMode =
		rpModeFromPrompt ||
		parseRpMode(normalizedBody.rp_mode) ||
		parseRpMode(normalizedBody.extra_body?.rp_mode) ||
		parseRpMode(normalizedBody.model_params?.rp_mode) ||
		parseRpMode(env.DEFAULT_RP_MODE) ||
		"none";

	const isRealThinkingEnabled = env.ENABLE_REAL_THINKING === "true";
	const includeReasoning = reasoningEffort ? reasoningEffort !== "none" : isRealThinkingEnabled;
	const cleanedMessages = cleanContext ? stripThinkingBlocks(otherMessages) : otherMessages;
	const rpPlannerModel = env.RP_PLANNER_MODEL?.trim() || undefined;
	const rpGmPlannerModel = env.RP_GM_PLANNER_MODEL?.trim() || DEFAULT_RP_GM_PLANNER_MODEL;
	const rpStateUpdateModel = env.RP_STATE_UPDATE_MODEL?.trim() || undefined;

	return {
		rawBody: normalizedBody,
		model,
		messages,
		otherMessages,
		cleanedMessages,
		systemPrompt,
		stream,
		showReasoning,
		cleanContext,
		includeReasoning,
		reasoningEffort: reasoningEffort || undefined,
		rpMode,
		rpPlannerModel,
		rpGmPlannerModel,
		rpStateUpdateModel,
		generationOptions: {
			max_tokens: normalizedBody.max_tokens,
			temperature: normalizedBody.temperature,
			top_p: normalizedBody.top_p,
			stop: normalizedBody.stop,
			presence_penalty: normalizedBody.presence_penalty,
			frequency_penalty: normalizedBody.frequency_penalty,
			seed: normalizedBody.seed,
			response_format: normalizedBody.response_format
		},
		tools: normalizedBody.tools,
		toolChoice: normalizedBody.tool_choice
	};
}

export function validatePreparedChatRequest(request: PreparedChatCompletionRequest): void {
	if (!request.messages.length) {
		throw new ChatHttpError("messages is a required field", 400);
	}

	const modelValidation = validateModel(request.model);
	if (!modelValidation.isValid) {
		throw new ChatHttpError(modelValidation.error || "Model validation failed", 400);
	}

	if (request.rpStateUpdateModel) {
		const stateModelValidation = validateModel(request.rpStateUpdateModel);
		if (!stateModelValidation.isValid) {
			throw new ChatHttpError(
				stateModelValidation.error || `RP state update model '${request.rpStateUpdateModel}' validation failed`,
				400
			);
		}
	}

	if (request.rpPlannerModel) {
		const plannerModelValidation = validateModel(request.rpPlannerModel);
		if (!plannerModelValidation.isValid) {
			throw new ChatHttpError(
				plannerModelValidation.error || `RP planner model '${request.rpPlannerModel}' validation failed`,
				400
			);
		}
	}

	if (request.rpGmPlannerModel) {
		const gmPlannerModelValidation = validateModel(request.rpGmPlannerModel);
		if (!gmPlannerModelValidation.isValid) {
			throw new ChatHttpError(
				gmPlannerModelValidation.error || `RP GM planner model '${request.rpGmPlannerModel}' validation failed`,
				400
			);
		}
	}

	const mediaChecks: {
		type: string;
		supportKey: keyof ModelInfo;
		name: string;
	}[] = [
		{ type: "image_url", supportKey: "supportsImages", name: "image inputs" },
		{ type: "input_audio", supportKey: "supportsAudios", name: "audio inputs" },
		{ type: "input_video", supportKey: "supportsVideos", name: "video inputs" },
		{ type: "input_pdf", supportKey: "supportsPdfs", name: "PDF inputs" }
	];

	for (const { type, supportKey, name } of mediaChecks) {
		const messagesWithMedia = request.messages.filter(
			(msg) => Array.isArray(msg.content) && msg.content.some((content) => content.type === type)
		);

		if (messagesWithMedia.length === 0) {
			continue;
		}

		if (!isMediaTypeSupported(request.model, supportKey)) {
			throw new ChatHttpError(
				`Model '${request.model}' does not support ${name}. Please use a model that supports this feature.`,
				400
			);
		}

		for (const msg of messagesWithMedia) {
			for (const content of msg.content as MessageContent[]) {
				if (content.type !== type) {
					continue;
				}

				const { isValid, error } = validateContent(type, content);
				if (!isValid) {
					throw new ChatHttpError(error || `Invalid ${type} payload`, 400);
				}
			}
		}
	}
}

export async function createChatServices(env: Env): Promise<ChatServices> {
	const authManager = new AuthManager(env);
	const geminiClient = new GeminiApiClient(env, authManager);

	try {
		await authManager.initializeAuth();
		console.log("Authentication successful");
	} catch (authError: unknown) {
		const errorMessage = authError instanceof Error ? authError.message : String(authError);
		console.error("Authentication failed:", errorMessage);
		throw new ChatHttpError("Authentication failed: " + errorMessage, 401);
	}

	return { authManager, geminiClient };
}

export async function handleDefaultChatCompletion(
	context: ChatRouteContext,
	request: PreparedChatCompletionRequest,
	createServicesFn: () => Promise<ChatServices>
): Promise<Response> {
	validatePreparedChatRequest(request);

	console.log("Request body parsed:", {
		model: request.model,
		messageCount: request.messages.length,
		stream: request.stream,
		includeReasoning: request.includeReasoning,
		reasoning_effort: request.reasoningEffort,
		tools: request.tools,
		tool_choice: request.toolChoice
	});

	const { geminiClient } = await createServicesFn();

	if (request.stream) {
		const { readable, writable } = new TransformStream();
		const writer = writable.getWriter();
		const openAITransformer = createOpenAIStreamTransformer(request.model);
		const openAIStream = readable.pipeThrough(openAITransformer);

		(async () => {
			try {
				console.log("Starting stream generation");
				const geminiStream = geminiClient.streamContent(request.model, request.systemPrompt, request.cleanedMessages, {
					includeReasoning: request.includeReasoning,
					reasoning_effort: request.reasoningEffort,
					tools: request.tools,
					tool_choice: request.toolChoice,
					showReasoning: request.showReasoning,
					...request.generationOptions
				});

				for await (const chunk of geminiStream) {
					await writer.write(chunk);
				}
				console.log("Stream completed successfully");
				await writer.close();
			} catch (streamError: unknown) {
				const errorMessage = streamError instanceof Error ? streamError.message : String(streamError);
				console.error("Stream error:", errorMessage);
				await writer.write({
					type: "text",
					data: `Error: ${errorMessage}`
				});
				await writer.close();
			}
		})();

		console.log("Returning streaming response");
		return new Response(openAIStream, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive"
			}
		});
	}

	try {
		console.log("Starting non-streaming completion");
		const completion = await geminiClient.getCompletion(request.model, request.systemPrompt, request.cleanedMessages, {
			includeReasoning: request.includeReasoning,
			reasoning_effort: request.reasoningEffort,
			tools: request.tools,
			tool_choice: request.toolChoice,
			showReasoning: request.showReasoning,
			...request.generationOptions
		});

		const response: ChatCompletionResponse = {
			id: `chatcmpl-${crypto.randomUUID()}`,
			object: "chat.completion",
			created: Math.floor(Date.now() / 1000),
			model: request.model,
			choices: [
				{
					index: 0,
					message: {
						role: "assistant",
						content: completion.content,
						tool_calls: completion.tool_calls
					},
					finish_reason: completion.tool_calls && completion.tool_calls.length > 0 ? "tool_calls" : "stop"
				}
			]
		};

		if (completion.usage) {
			response.usage = {
				prompt_tokens: completion.usage.inputTokens,
				completion_tokens: completion.usage.outputTokens,
				total_tokens: completion.usage.inputTokens + completion.usage.outputTokens
			};
		}

		console.log("Non-streaming completion successful");
		return context.json(response);
	} catch (completionError: unknown) {
		const errorMessage = completionError instanceof Error ? completionError.message : String(completionError);
		console.error("Completion error:", errorMessage);
		return context.json({ error: errorMessage }, 500);
	}
}

export async function handleAudioTranscription(context: ChatRouteContext): Promise<Response> {
	try {
		console.log("Audio transcription request received");
		const body = await context.req.parseBody();
		const file = body["file"];
		const model = (body["model"] as string) || DEFAULT_MODEL;
		const prompt = (body["prompt"] as string) || "Transcribe this audio in detail.";

		if (!file || !(file instanceof File)) {
			return context.json({ error: "File is required" }, 400);
		}

		const modelValidation = validateModel(model);
		if (!modelValidation.isValid) {
			return context.json({ error: modelValidation.error }, 400);
		}

		let mimeType = file.type;

		if (mimeType === "application/octet-stream" && file.name) {
			const ext = file.name.split(".").pop()?.toLowerCase();
			if (ext && MIME_TYPE_MAP[ext]) {
				mimeType = MIME_TYPE_MAP[ext];
				console.log(`Detected MIME type from extension .${ext}: ${mimeType}`);
			}
		}

		const isVideo = mimeType.startsWith("video/");
		const isAudio = mimeType.startsWith("audio/");

		if (isVideo) {
			if (!isMediaTypeSupported(model, "supportsVideos")) {
				return context.json({ error: `Model '${model}' does not support video inputs.` }, 400);
			}
		} else if (isAudio) {
			if (!isMediaTypeSupported(model, "supportsAudios")) {
				return context.json({ error: `Model '${model}' does not support audio inputs.` }, 400);
			}
		} else {
			return context.json(
				{
					error: `Unsupported media type: ${mimeType}. Only audio and video files are supported.`
				},
				400
			);
		}

		const arrayBuffer = await file.arrayBuffer();
		console.log(`Processing audio file: size=${arrayBuffer.byteLength} bytes, type=${file.type}`);

		let base64Audio: string;
		try {
			base64Audio = Buffer.from(arrayBuffer).toString("base64");
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error("Base64 conversion failed:", errorMessage);
			throw new Error(`Failed to process audio file: ${errorMessage}`);
		}

		const messages: ChatMessage[] = [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: prompt
					},
					{
						type: "input_audio",
						input_audio: {
							data: base64Audio,
							format: mimeType
						}
					}
				]
			}
		];

		const { geminiClient } = await createChatServices(context.env);
		const completion = await geminiClient.getCompletion(model, "", messages);

		return context.json({ text: completion.content });
	} catch (error: unknown) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error("Transcription error:", errorMessage);
		return context.json({ error: errorMessage }, 500);
	}
}
