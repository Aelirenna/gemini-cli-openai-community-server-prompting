import { createChatServices, handleDefaultChatCompletion } from "./default-handler";
import { ChatAddon, ChatAddonTools, ChatRouteContext, PreparedChatCompletionRequest } from "./types";

export async function runChatAddonPipeline(
	context: ChatRouteContext,
	initialRequest: PreparedChatCompletionRequest,
	addons: ChatAddon[]
): Promise<Response> {
	let request = initialRequest;

	for (const addon of addons) {
		if (!addon.preprocessRequest) {
			continue;
		}

		request = await addon.preprocessRequest(request, context);
	}

	let servicesPromise: ReturnType<typeof createChatServices> | null = null;
	const createServices = () => {
		if (!servicesPromise) {
			servicesPromise = createChatServices(context.env);
		}
		return servicesPromise;
	};

	const tools: ChatAddonTools = {
		createServices,
		runDefault: () => handleDefaultChatCompletion(context, request, createServices)
	};

	for (const addon of addons) {
		if (!addon.handleRequest) {
			continue;
		}

		const response = await addon.handleRequest(request, context, tools);
		if (response) {
			return response;
		}
	}

	return tools.runDefault();
}
