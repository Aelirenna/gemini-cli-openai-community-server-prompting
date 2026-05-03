import { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AuthManager } from "../../auth";
import { GeminiApiClient } from "../../gemini-client";
import { ChatCompletionRequest, ChatMessage, EffortLevel, Env, RpMode, Tool, ToolChoice } from "../../types";

export interface ChatGenerationOptions {
	max_tokens?: number;
	temperature?: number;
	top_p?: number;
	stop?: string | string[];
	presence_penalty?: number;
	frequency_penalty?: number;
	seed?: number;
	response_format?: {
		type: "text" | "json_object";
	};
}

export interface PreparedChatCompletionRequest {
	rawBody: ChatCompletionRequest;
	model: string;
	messages: ChatMessage[];
	otherMessages: ChatMessage[];
	cleanedMessages: ChatMessage[];
	systemPrompt: string;
	stream: boolean;
	showReasoning: boolean;
	cleanContext: boolean;
	includeReasoning: boolean;
	reasoningEffort?: EffortLevel;
	rpMode: RpMode;
	rpGmPlannerModel?: string;
	rpStateUpdateModel?: string;
	generationOptions: ChatGenerationOptions;
	tools?: Tool[];
	toolChoice?: ToolChoice;
}

export type ChatRouteContext = Context<{ Bindings: Env }>;

export interface ChatServices {
	authManager: AuthManager;
	geminiClient: GeminiApiClient;
}

export interface ChatAddonTools {
	createServices: () => Promise<ChatServices>;
	runDefault: () => Promise<Response>;
}

export interface ChatAddon {
	name: string;
	preprocessRequest?: (
		request: PreparedChatCompletionRequest,
		context: ChatRouteContext
	) => Promise<PreparedChatCompletionRequest> | PreparedChatCompletionRequest;
	handleRequest?: (
		request: PreparedChatCompletionRequest,
		context: ChatRouteContext,
		tools: ChatAddonTools
	) => Promise<Response | null> | Response | null;
}

export class ChatHttpError extends Error {
	public readonly status: ContentfulStatusCode;

	constructor(message: string, status: ContentfulStatusCode) {
		super(message);
		this.name = "ChatHttpError";
		this.status = status;
	}
}
