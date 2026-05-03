import type { ChatMessage } from "../src/types";
import type { ChatServices, PreparedChatCompletionRequest } from "../src/core/chat/types";
import {
	buildCurrentSituation,
	buildGmCurrentSituation,
	extractPreviousState,
	interpretState,
	parseRules,
	relationshipRulesContent
} from "../src/addons/rp/compiler";
import { rpAddon } from "../src/addons/rp";
import { runCustomRpTurn, runNormalRpTurn } from "../src/addons/rp/runtime";

type StageName = "state" | "gm_planner" | "character_planner" | "prose" | "custom_planner" | "custom_prose" | "custom_ooc";

interface StageCall {
	model: string;
	system: string;
	messages: ChatMessage[];
	options: Record<string, unknown>;
}

function expect(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(`RP runtime fixture failed: ${message}`);
	}
}

function contentToText(content: ChatMessage["content"]): string {
	if (typeof content === "string") {
		return content;
	}

	return content.map((part) => (part.type === "text" ? part.text ?? "" : "")).join("\n");
}

function messagesToText(messages: ChatMessage[]): string {
	return messages.map((message) => contentToText(message.content)).join("\n\n");
}

function getStage(system: string, messages: ChatMessage[]): StageName {
	const lastUserPayload = contentToText(messages[messages.length - 1]?.content ?? "");
	if (system.includes("You are the state finalizer step.") || lastUserPayload.includes("<state_finalizer_request>")) {
		return "state";
	}
	if (lastUserPayload.includes("# OOC ANALYSIS MODE") && system.includes("<custom_system_prompt>")) {
		return "custom_ooc";
	}
	if (lastUserPayload.includes("<custom_planner_stage>")) {
		return "custom_planner";
	}
	if (lastUserPayload.includes("<custom_prose_stage>")) {
		return "custom_prose";
	}
	if (lastUserPayload.includes("<prose_execution>")) {
		return "prose";
	}
	if (lastUserPayload.includes("<character_plan>")) {
		return "character_planner";
	}
	if (lastUserPayload.includes("<gm_plan>")) {
		return "gm_planner";
	}
	throw new Error("Unknown RP stage prompt.");
}

function makeRequest(messages: ChatMessage[], rpMode: "my" | "yaoshi" = "yaoshi"): PreparedChatCompletionRequest {
	const systemPrompt = contentToText(messages.find((message) => message.role === "system")?.content ?? "");
	const otherMessages = messages.filter((message) => message.role !== "system");

	return {
		rawBody: {
			model: "gemini-fixture",
			messages,
			stream: false,
			rp_mode: rpMode
		},
		model: "gemini-fixture",
		messages,
		otherMessages,
		cleanedMessages: otherMessages,
		systemPrompt,
		stream: false,
		showReasoning: false,
		cleanContext: true,
		includeReasoning: false,
		rpMode,
		rpPlannerModel: rpMode === "my" ? "gemini-3-flash-preview" : undefined,
		generationOptions: {
			temperature: 0.7,
			top_p: 0.9,
			response_format: {
				type: "json_object"
			},
			stop: ["<stop>"]
		}
	};
}

function makeMessages(includePreviousState = true): ChatMessage[] {
	const previousState =
		'<state>{"date_time":"Morning","characters":{"Yaoshi":{"r":5,"rf":"FR","pr":null,"loc":"Garden","sex":false,"traits":"Calm,Curious","triggered_milestones":[]}},"threads":"garden tension: first meeting remains unresolved beyond the current cup exchange"}</state>';

	return [
		{
			role: "system",
			content:
				"rp_mode=yaoshi\n" +
				"<Yaoshi's Persona>\nYaoshi is calm, curious, and difficult to read.\n</Yaoshi's Persona>\n" +
				"<Scenario>\nYaoshi and {{user}} are speaking in a quiet garden after a tense first meeting.\n</Scenario>\n" +
				"<UserPersona>\n{{user}} is direct and observant.\n</UserPersona>"
		},
		{
			role: "user",
			content: "I came back because I wanted to understand you, not argue."
		},
		{
			role: "assistant",
			content: includePreviousState ? `Yaoshi watched in silence.\n\n${previousState}` : "Yaoshi watched in silence."
		},
		{
			role: "user",
			content: "I leave the cup on the stone table and wait instead of pushing."
		}
	];
}

function makeCustomMessages(): ChatMessage[] {
	const previousTechnicalState =
		'<state>{"date_time":"Old","characters":{"Other":{"r":1,"rf":"FR","pr":null,"loc":"Room","sex":false,"traits":"Calm","triggered_milestones":[]}}}</state>';

	return [
		{
			role: "system",
			content:
				"rp_mode=my\n" +
				"<Custom Character's Persona>\nCustom character is observant.\n</Custom Character's Persona>\n" +
				"<Scenario>\nCustom character and {{user}} are in a workshop.\n</Scenario>\n" +
				"<UserPersona>\n{{user}} tests systems carefully.\n</UserPersona>"
		},
		{
			role: "user",
			content: "I set the broken device on the table."
		},
		{
			role: "assistant",
			content: `The room stayed quiet.\n\n${previousTechnicalState}`
		},
		{
			role: "user",
			content: "I wait to see what they do with it."
		}
	];
}

function makeServices(calls: StageCall[], overrides: Partial<Record<StageName, string>> = {}): ChatServices {
	const stateBlock =
		'<state>{"date_time":"Morning","characters":{"Yaoshi":{"r":6,"rf":"FR","pr":null,"loc":"Garden","sex":false,"traits":"Calm,Curious","triggered_milestones":[]}},"threads":"garden tension: first meeting remains unresolved beyond the current cup exchange"}</state>';
	const gmPlanBlock =
		"<gm_plan>\n" +
		"<world>Keep the garden quiet and let the unanswered cup remain the turn-level opening.</world>\n" +
		"</gm_plan>";
	const characterPlanBlock =
		"<character_plan>\n" +
		"<character>Yaoshi registers the restraint as a small positive movement, not instant trust.</character>\n" +
		"</character_plan>";
	const proseText = "Yaoshi looked at the cup before he answered, quieter than before.\n\n<state>{\"bad\":true}</state>";
	const customPlannerBlock =
		"<gm_reasoning>\n" +
		"<plan>Use the custom prompt and plan a concise response about the broken device.</plan>\n" +
		"</gm_reasoning>";
	const customProseText =
		"They took the device carefully and turned it toward the light.\n\n<gm_reasoning>bad leak</gm_reasoning>\n\n<state>{\"bad\":true}</state>";
	const customOocText = "Custom OOC answer.";

	return {
		authManager: {} as ChatServices["authManager"],
		geminiClient: {
			async getCompletion(model: string, system: string, messages: ChatMessage[], options?: Record<string, unknown>) {
				const stage = getStage(system, messages);
				calls.push({
					model,
					system,
					messages,
					options: options ?? {}
				});

				return {
					content:
						overrides[stage] ??
						(stage === "state"
							? stateBlock
							: stage === "gm_planner"
								? gmPlanBlock
								: stage === "character_planner"
									? characterPlanBlock
							: stage === "custom_planner"
								? customPlannerBlock
								: stage === "custom_prose"
									? customProseText
									: stage === "custom_ooc"
										? customOocText
										: proseText)
				};
			}
		} as ChatServices["geminiClient"]
	};
}

function expectHistoryIsStateClean(call: StageCall, stage: string): void {
	const historyMessages = call.messages.slice(0, -1);
	const historyText = messagesToText(historyMessages);
	expect(!historyText.includes("<state>"), `${stage} history received an old <state> block`);
	expect(!historyText.includes('"r":5'), `${stage} history received raw previous r`);
	expect(!historyText.includes('"rf":"FR"'), `${stage} history received raw previous rf`);
}

async function testNormalPipeline(): Promise<void> {
	const calls: StageCall[] = [];
	const result = await runNormalRpTurn(makeServices(calls), makeRequest(makeMessages()));

	expect(calls.length === 4, `expected 4 stage calls, got ${calls.length}`);
	expect(getStage(calls[0].system, calls[0].messages) === "gm_planner", "first call must be GM planner");
	expect(getStage(calls[1].system, calls[1].messages) === "character_planner", "second call must be character planner");
	expect(getStage(calls[2].system, calls[2].messages) === "prose", "third call must be prose");
	expect(getStage(calls[3].system, calls[3].messages) === "state", "fourth call must be state finalizer");
	expect(calls[0].model === "gemini-3-flash-preview", "GM planner must use Flash model override");
	expect(calls[1].model === "gemini-fixture", "character planner must use request model");
	expect(calls[0].system.includes("<reference_material>"), "GM planner must receive reference material as system");
	expect(calls[1].system.includes("<reference_material>"), "character planner must receive reference material as system");
	expect(!calls[0].system.includes("<planner_canon>"), "GM planner canon must not be sent as system");
	expect(!calls[1].system.includes("<planner_canon>"), "character planner canon must not be sent as system");

	for (const [index, stage] of ["gm_planner", "character_planner", "prose", "state"].entries()) {
		expectHistoryIsStateClean(calls[index], stage);
	}

	const gmPlannerUserPayload = contentToText(calls[0].messages[calls[0].messages.length - 1].content);
	expect(gmPlannerUserPayload.includes("<gm_plan_request>"), "GM planner must receive plan request in user payload");
	expect(gmPlannerUserPayload.includes("This step is not the character planner."), "GM planner must receive hard character-boundary instruction");
	expect(gmPlannerUserPayload.includes("Forbidden section topics inside <gm_plan>:"), "GM planner must receive forbidden section topics");
	expect(gmPlannerUserPayload.includes("If the scene is sexual, the GM plan may name only external circumstances and scene phase."), "GM planner must receive NSFW boundary instruction");
	expect(gmPlannerUserPayload.includes("<planner_prompt_sections>"), "GM planner must receive prompt sections in user payload");
	expect(gmPlannerUserPayload.includes("<planner_canon>"), "GM planner must receive planner canon in user payload");
	expect(gmPlannerUserPayload.includes("# Role separation"), "GM planner must receive full canon sections in user payload");
	expect(!gmPlannerUserPayload.includes("<reference_material>"), "GM planner must not receive reference material in user payload");
	expect(gmPlannerUserPayload.includes("<current_situation>"), "GM planner must receive current_situation");
	expect(
		gmPlannerUserPayload.includes("Long-story threads (memory, not a command queue):"),
		"GM planner must receive story threads in current_situation"
	);
	expect(gmPlannerUserPayload.includes("- Location: Garden"), "GM planner must receive location in current_situation");
	expect(!gmPlannerUserPayload.includes("Attitude towards the {{user}}"), "GM planner must not receive relationship meaning");
	expect(!gmPlannerUserPayload.includes("Traits:"), "GM planner must not receive traits");
	expect(!gmPlannerUserPayload.includes("THEMATIC FOCUS"), "GM planner must not receive milestone focus");
	expect(gmPlannerUserPayload.includes("<gm_plan>"), "GM planner must receive GM plan structure");
	expect(!gmPlannerUserPayload.includes("<previous_technical_state>"), "GM planner must not receive previous technical state");
	expect(!gmPlannerUserPayload.includes("<decoded_previous_state>"), "GM planner must not receive decoded previous state");
	expect(!gmPlannerUserPayload.includes('"r":'), "GM planner must not receive raw r JSON");
	expect(!gmPlannerUserPayload.includes('"rf":'), "GM planner must not receive raw rf JSON");

	const characterPlannerUserPayload = contentToText(calls[1].messages[calls[1].messages.length - 1].content);
	expect(characterPlannerUserPayload.includes("<character_plan_request>"), "character planner must receive plan request in user payload");
	expect(characterPlannerUserPayload.includes("<planner_prompt_sections>"), "character planner must receive prompt sections in user payload");
	expect(characterPlannerUserPayload.includes("<planner_canon>"), "character planner must receive planner canon in user payload");
	expect(characterPlannerUserPayload.includes("# Playing & portrayal"), "character planner must receive full canon sections in user payload");
	expect(!characterPlannerUserPayload.includes("<reference_material>"), "character planner must not receive reference material in user payload");
	expect(characterPlannerUserPayload.includes("<current_situation>"), "character planner must receive current_situation");
	expect(characterPlannerUserPayload.includes("<approved_gm_plan>"), "character planner must receive approved GM plan");
	expect(characterPlannerUserPayload.includes("<character_plan>"), "character planner must receive character plan structure");
	expect(!characterPlannerUserPayload.includes("<previous_technical_state>"), "character planner must not receive previous technical state");
	expect(!characterPlannerUserPayload.includes("<decoded_previous_state>"), "character planner must not receive decoded previous state");
	expect(!characterPlannerUserPayload.includes('"r":'), "character planner must not receive raw r JSON");
	expect(!characterPlannerUserPayload.includes('"rf":'), "character planner must not receive raw rf JSON");

	const proseUserPayload = contentToText(calls[2].messages[calls[2].messages.length - 1].content);
	expect(proseUserPayload.includes("<prose_execution>"), "prose instructions must be sent as user task");
	expect(proseUserPayload.includes("<current_situation>"), "prose must receive current_situation");
	expect(proseUserPayload.includes("<approved_plan>"), "prose must receive approved_plan");
	expect(proseUserPayload.includes("<approved_gm_plan>"), "prose must receive approved GM plan");
	expect(proseUserPayload.includes("<approved_character_plan>"), "prose must receive approved character plan");
	expect(!proseUserPayload.includes("<previous_technical_state>"), "prose must not receive previous technical state");
	expect(!proseUserPayload.includes("<decoded_previous_state>"), "prose must not receive decoded previous state");
	expect(!proseUserPayload.includes('"r":'), "prose must not receive raw r JSON");
	expect(!proseUserPayload.includes('"rf":'), "prose must not receive raw rf JSON");
	expect(!calls[2].system.includes("<prose_execution>"), "prose instructions must not be sent as system");

	const stateUserPayload = contentToText(calls[3].messages[calls[3].messages.length - 1].content);
	const stateProseMessage = calls[3].messages[calls[3].messages.length - 2];
	expect(calls[3].system.includes("You are the state finalizer step."), "state finalizer instructions must be sent as system");
	expect(!stateUserPayload.includes("You are the state finalizer step."), "state finalizer instructions must not be repeated in user task");
	expect(stateUserPayload.includes("<previous_technical_state>"), "state finalizer must receive previous technical state");
	expect(stateUserPayload.includes("<decoded_previous_state>"), "state finalizer must receive decoded previous state");
	expect(stateUserPayload.includes("<current_situation>"), "state finalizer must receive starting current_situation");
	expect(stateUserPayload.includes("<approved_gm_plan>"), "state finalizer must receive GM plan");
	expect(stateUserPayload.includes("<approved_character_plan>"), "state finalizer must receive character plan");
	expect(!calls[3].system.includes("<reference_material>"), "state finalizer must not receive reference material");
	expect(!calls[3].system.includes("<state_update_canon>"), "state finalizer must not receive state_update_canon");
	expect(stateProseMessage.role === "assistant", "state finalizer must receive written prose as assistant message");
	expect(contentToText(stateProseMessage.content).includes("Yaoshi looked at the cup"), "state finalizer assistant message must contain written prose");
	expect(!contentToText(stateProseMessage.content).includes("<state>"), "state finalizer assistant prose must be state-clean");

	expect(calls[0].options.temperature === 1, "GM planner temperature override changed");
	expect(calls[0].options.top_p === 0.8, "GM planner top_p override changed");
	expect(calls[1].options.temperature === 1, "character planner temperature override changed");
	expect(calls[1].options.top_p === 0.8, "character planner top_p override changed");
	expect(calls[2].options.temperature === 0.7, "prose should preserve request temperature");
	expect(calls[2].options.top_p === 0.9, "prose should preserve request top_p");
	expect(calls[3].options.temperature === 0.2, "state finalizer temperature override changed");
	expect(calls[3].options.top_p === 0.5, "state finalizer top_p override changed");
	expect(!("response_format" in calls[3].options), "state finalizer must strip response_format");
	expect(!("stop" in calls[3].options), "state finalizer must strip stop");

	expect(result.includes("Yaoshi looked at the cup"), "final result must include prose");
	expect(!result.includes('"bad":true'), "accidental prose state block must be stripped");
	expect(result.endsWith(
		'<state>{"date_time":"Morning","characters":{"Yaoshi":{"r":6,"rf":"FR","pr":null,"loc":"Garden","sex":false,"traits":"Calm,Curious","triggered_milestones":[]}},"threads":"garden tension: first meeting remains unresolved beyond the current cup exchange"}</state>'
	), "final result must append exact state block from state update");
}

async function testCustomPipeline(): Promise<void> {
	const calls: StageCall[] = [];
	const result = await runCustomRpTurn(makeServices(calls), makeRequest(makeCustomMessages(), "my"));

	expect(calls.length === 2, `custom mode expected 2 stage calls, got ${calls.length}`);
	expect(getStage(calls[0].system, calls[0].messages) === "custom_planner", "custom first call must be planner");
	expect(getStage(calls[1].system, calls[1].messages) === "custom_prose", "custom second call must be prose");
	expect(calls[0].model === "gemini-3-flash-preview", "custom planner must use RP_PLANNER_MODEL override");
	expect(calls[1].model === "gemini-fixture", "custom prose must use request model");

	for (const [index, stage] of ["custom_planner", "custom_prose"].entries()) {
		expectHistoryIsStateClean(calls[index], stage);
	}

	const plannerSystem = calls[0].system;
	expect(plannerSystem.includes("<custom_system_prompt>"), "custom planner must receive custom_system_prompt");
	expect(plannerSystem.includes("<reference_material>"), "custom planner must receive reference material");
	expect(plannerSystem.indexOf("<custom_system_prompt>") < plannerSystem.indexOf("<reference_material>"), "custom_system_prompt must be above reference material");
	expect(!plannerSystem.includes("<custom_planner_directive>"), "custom planner directive must not be sent as system");
	expect(!plannerSystem.includes("<planner_canon>"), "custom planner must not receive yaoshi planner canon");
	expect(!plannerSystem.includes("<state_update_canon>"), "custom planner must not receive state update canon");

	const plannerUserPayload = contentToText(calls[0].messages[calls[0].messages.length - 1].content);
	expect(plannerUserPayload.includes("<custom_planner_directive>"), "custom planner must receive custom_planner_directive as user task");
	expect(plannerUserPayload.includes("<custom_planner_stage>"), "custom planner instructions must be sent as user task");
	expect(plannerUserPayload.indexOf("<custom_planner_directive>") < plannerUserPayload.indexOf("<custom_planner_stage>"), "custom planner directive must be before stage task");
	expect(!plannerUserPayload.includes("<current_situation>"), "custom planner must not receive current_situation");
	expect(!plannerUserPayload.includes("<previous_technical_state>"), "custom planner must not receive previous technical state");
	expect(!plannerSystem.includes("<custom_planner_stage>"), "custom planner stage instructions must not be sent as system");

	const proseSystem = calls[1].system;
	expect(proseSystem.includes("<reference_material>"), "custom prose must receive reference material");
	expect(!proseSystem.includes("<custom_prose_instructions>"), "custom prose instructions must not be sent as system");
	expect(!proseSystem.includes("<prose_canon>"), "custom prose must not receive yaoshi prose canon");

	const proseUserPayload = contentToText(calls[1].messages[calls[1].messages.length - 1].content);
	expect(proseUserPayload.includes("<custom_prose_instructions>"), "custom prose must receive custom_prose_instructions as user task");
	expect(proseUserPayload.includes("<custom_prose_stage>"), "custom prose instructions must be sent as user task");
	expect(proseUserPayload.indexOf("<custom_prose_instructions>") < proseUserPayload.indexOf("<custom_prose_stage>"), "custom prose instructions must be before stage task");
	expect(proseUserPayload.includes("<approved_plan>"), "custom prose must receive approved plan");
	expect(proseUserPayload.includes("<gm_reasoning>"), "custom prose approved plan must include planner output");
	expect(!proseUserPayload.includes("<current_situation>"), "custom prose must not receive current_situation");
	expect(!proseSystem.includes("<custom_prose_stage>"), "custom prose stage instructions must not be sent as system");

	expect(calls[0].options.temperature === 1, "custom planner temperature override changed");
	expect(calls[0].options.top_p === 0.8, "custom planner top_p override changed");
	expect(calls[1].options.temperature === 0.7, "custom prose should preserve request temperature");
	expect(calls[1].options.top_p === 0.9, "custom prose should preserve request top_p");

	expect(result.includes("They took the device carefully"), "custom final result must include prose");
	expect(!result.includes("<gm_reasoning>"), "custom final result must not include leaked gm_reasoning");
	expect(!result.includes("<state>"), "custom final result must not include state block");
}

async function testMissingPreviousState(): Promise<void> {
	await expectRejects(
		() => runNormalRpTurn(makeServices([]), makeRequest(makeMessages(false))),
		"State update requires a previous <state> block."
	);
}

async function testMalformedStageOutputs(): Promise<void> {
	await expectRejects(
		() => runNormalRpTurn(makeServices([], { state: "no state here" }), makeRequest(makeMessages())),
		"State update step did not return a <state> block."
	);
	await expectRejects(
		() => runNormalRpTurn(makeServices([], { gm_planner: "no planner here" }), makeRequest(makeMessages())),
		"Planner step did not return a <gm_plan> block."
	);
	await expectRejects(
		() => runNormalRpTurn(makeServices([], { character_planner: "no planner here" }), makeRequest(makeMessages())),
		"Planner step did not return a <character_plan> block."
	);
}

async function testCustomOocRouting(): Promise<void> {
	const calls: StageCall[] = [];
	const messages = makeCustomMessages();
	messages[messages.length - 1] = {
		role: "user",
		content: "OOC: why did that response fail?"
	};
	const request = makeRequest(messages, "my");
	request.model = "gemini-2.5-flash";
	request.rawBody.model = "gemini-2.5-flash";
	const response = await rpAddon.handleRequest!(
		request,
		{
			json(payload: unknown, status?: number) {
				return Response.json(payload, { status });
			}
		} as Parameters<NonNullable<typeof rpAddon.handleRequest>>[1],
		{
			createServices: async () => makeServices(calls),
			runDefault: async () => new Response("default")
		}
	);

	expect(response instanceof Response, "custom OOC must return a Response");
	const body = await response.json() as { choices?: Array<{ message?: { content?: string | null } }> };
	expect(calls.length === 1, `custom OOC expected 1 model call, got ${calls.length}`);
	expect(getStage(calls[0].system, calls[0].messages) === "custom_ooc", "custom OOC must use OOC stage");
	expect(calls[0].system.includes("<custom_system_prompt>"), "custom OOC must receive custom_system_prompt");
	expect(!calls[0].system.includes("<custom_planner_directive>"), "custom OOC planner directive must not be sent as system");
	expect(!calls[0].system.includes("<custom_prose_instructions>"), "custom OOC prose instructions must not be sent as system");
	expect(calls[0].system.includes("<reference_material>"), "custom OOC must receive reference material");
	const userPayload = contentToText(calls[0].messages[calls[0].messages.length - 1].content);
	expect(userPayload.includes("<custom_planner_directive>"), "custom OOC must receive custom_planner_directive as user task");
	expect(userPayload.includes("<custom_prose_instructions>"), "custom OOC must receive custom prose instructions as user task");
	expect(userPayload.includes("# OOC ANALYSIS MODE"), "custom OOC must receive OOC request prompt");
	expect(body.choices?.[0]?.message?.content === "Custom OOC answer.", "custom OOC response content mismatch");
}

function testPregnancyCurrentSituation(): void {
	const rules = parseRules(relationshipRulesContent);
	const legacyState = extractPreviousState([
		{
			role: "assistant",
			content:
				'<state>{"date_time":"Day 12","characters":{"Yaoshi":{"r":120,"rf":"LV","pr":"Y","loc":"Room","sex":false,"traits":"Calm","triggered_milestones":[]}}}</state>'
		}
	]);
	const legacySituation = buildCurrentSituation(interpretState(legacyState, rules));
	const legacyGmSituation = buildGmCurrentSituation(interpretState(legacyState, rules));
	expect(
		legacyState.characters.Yaoshi.PR?.discovered === false,
		"legacy pr=Y must normalize to undiscovered pregnancy"
	);
	expect(legacySituation.includes("conception/pregnancy exists as technical GM truth"), "legacy pr=Y must appear in current_situation");
	expect(legacySituation.includes("Characters do not automatically know this"), "hidden pregnancy must block automatic knowledge");
	expect(legacyGmSituation.includes("conception/pregnancy exists as technical GM truth"), "GM current_situation must receive pregnancy");
	expect(!legacyGmSituation.includes("Attitude towards the {{user}}"), "GM current_situation must not receive relationship meaning");
	expect(!legacyGmSituation.includes("Traits:"), "GM current_situation must not receive traits");

	const discoveredState = extractPreviousState([
		{
			role: "assistant",
			content:
				'<state>{"date_time":"Day 40","characters":{"Yaoshi":{"r":120,"rf":"LV","pr":{"target":"Yaoshi","isPregnant":"Y","discovered":true,"conceived_at":"Day 12","discovered_at":"Day 40"},"loc":"Clinic","sex":false,"traits":"Calm","triggered_milestones":[]}}}</state>'
		}
	]);
	const discoveredSituation = buildCurrentSituation(interpretState(discoveredState, rules));
	expect(discoveredSituation.includes("known in played reality"), "discovered pregnancy must be visible");
	expect(discoveredSituation.includes("Discovered at: Day 40"), "discovered_at must be included");

	const sexState = extractPreviousState([
		{
			role: "assistant",
			content:
				'<state>{"date_time":"Night","characters":{"Yaoshi":{"r":120,"rf":"LV","pr":null,"loc":"Room","sex":true,"traits":"Calm","triggered_milestones":[]}}}</state>'
		}
	]);
	const sexGmSituation = buildGmCurrentSituation(interpretState(sexState, rules));
	expect(sexGmSituation.includes("Sex scene: active"), "GM current_situation must receive sex scene marker");
	expect(!sexGmSituation.includes("Attitude towards the {{user}}"), "GM sex current_situation must not receive relationship meaning");
	expect(!sexGmSituation.includes("Traits:"), "GM sex current_situation must not receive traits");
}

async function expectRejects(action: () => Promise<unknown>, expectedMessage: string): Promise<void> {
	try {
		await action();
	} catch (error) {
		expect(error instanceof Error, "expected thrown value to be an Error");
		expect(error.message === expectedMessage, `expected "${expectedMessage}", got "${error.message}"`);
		return;
	}

	throw new Error(`RP runtime fixture failed: expected rejection "${expectedMessage}"`);
}

export async function runRpRuntimeFixture(): Promise<void> {
	await testNormalPipeline();
	await testCustomPipeline();
	await testCustomOocRouting();
	await testMissingPreviousState();
	await testMalformedStageOutputs();
	testPregnancyCurrentSituation();
	console.log("RP runtime fixture passed.");
}

void runRpRuntimeFixture();
