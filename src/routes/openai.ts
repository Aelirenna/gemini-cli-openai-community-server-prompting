import { Hono } from "hono";
import { Env } from "../types";
import { getAllModelIds } from "../models";
import { OPENAI_MODEL_OWNER } from "../config";
import { installedChatAddons } from "../addons";
import { buildPreparedChatRequest, handleAudioTranscription } from "../core/chat/default-handler";
import { runChatAddonPipeline } from "../core/chat/pipeline";
import { ChatHttpError } from "../core/chat/types";

/**
 * OpenAI-compatible API routes for models and chat completions.
 */
export const OpenAIRoute = new Hono<{ Bindings: Env }>();

// List available models
OpenAIRoute.get("/models", async (c) => {
	const modelData = getAllModelIds().map((modelId) => ({
		id: modelId,
		object: "model",
		created: Math.floor(Date.now() / 1000),
		owned_by: OPENAI_MODEL_OWNER
	}));

	return c.json({
		object: "list",
		data: modelData
	});
});

// Retrieve a specific model
OpenAIRoute.get("/models/:model", async (c) => {
	const modelId = c.req.param("model");
	const allRealModels = getAllModelIds();

	if (allRealModels.includes(modelId)) {
		const modelData = {
			id: modelId,
			object: "model",
			created: Math.floor(Date.now() / 1000),
			owned_by: OPENAI_MODEL_OWNER
		};
		return c.json(modelData);
	} else {
		return c.json({ error: "Model not found" }, 404);
	}
});

// Chat completions endpoint
OpenAIRoute.post("/chat/completions", async (c) => {
	try {
		console.log("Chat completions request received");
		const body = await c.req.json();
		const request = buildPreparedChatRequest(body, c.env);
		return await runChatAddonPipeline(c, request, installedChatAddons);
	} catch (e: unknown) {
		if (e instanceof ChatHttpError) {
			return c.json({ error: e.message }, e.status);
		}
		const errorMessage = e instanceof Error ? e.message : String(e);
		console.error("Top-level error:", e);
		return c.json({ error: errorMessage }, 500);
	}
});

// Audio transcriptions endpoint
OpenAIRoute.post("/audio/transcriptions", async (c) => {
	return handleAudioTranscription(c);
});
