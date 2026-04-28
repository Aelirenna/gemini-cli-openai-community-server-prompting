import type { ChatMessage } from "../src/types";
import type { ChatServices, PreparedChatCompletionRequest } from "../src/core/chat/types";
import { buildCurrentSituation, extractPreviousState, interpretState, parseRules, relationshipRulesContent } from "../src/addons/rp/compiler";
import { runCustomRpTurn, runNormalRpTurn } from "../src/addons/rp/runtime";

type StageName = "state" | "planner" | "prose" | "custom_planner" | "custom_prose";

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
	if (lastUserPayload.includes("You are the state update step.")) {
		return "state";
	}
	if (lastUserPayload.includes("<custom_planner_stage>")) {
		return "custom_planner";
	}
	if (lastUserPayload.includes("<custom_prose_stage>")) {
		return "custom_prose";
	}
	if (system.includes("<planner_canon>")) {
		return "planner";
	}
	if (lastUserPayload.includes("<prose_execution>")) {
		return "prose";
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
		'<state>{"date_time":"Morning","characters":{"Yaoshi":{"r":5,"rf":"FR","pr":null,"loc":"Garden","sex":false,"traits":"Calm,Curious","triggered_milestones":[]}}}</state>';

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
		'<state>{"date_time":"Morning","characters":{"Yaoshi":{"r":6,"rf":"FR","pr":null,"loc":"Garden","sex":false,"traits":"Calm,Curious","triggered_milestones":[]}}}</state>';
	const plannerBlock =
		"<gm_reasoning>\n" +
		"<current_situation_guard>Yaoshi registers the restraint as a small positive movement, not instant trust.</current_situation_guard>\n" +
		"<prose_handoff>Write a quiet response that acknowledges the cup and leaves room for {{user}}.</prose_handoff>\n" +
		"</gm_reasoning>";
	const proseText = "Yaoshi looked at the cup before he answered, quieter than before.\n\n<state>{\"bad\":true}</state>";
	const customPlannerBlock =
		"<gm_reasoning>\n" +
		"<plan>Use the custom prompt and plan a concise response about the broken device.</plan>\n" +
		"</gm_reasoning>";
	const customProseText =
		"They took the device carefully and turned it toward the light.\n\n<gm_reasoning>bad leak</gm_reasoning>\n\n<state>{\"bad\":true}</state>";

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
							: stage === "planner"
								? plannerBlock
								: stage === "custom_planner"
									? customPlannerBlock
									: stage === "custom_prose"
										? customProseText
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

	expect(calls.length === 3, `expected 3 stage calls, got ${calls.length}`);
	expect(getStage(calls[0].system, calls[0].messages) === "state", "first call must be state update");
	expect(getStage(calls[1].system, calls[1].messages) === "planner", "second call must be planner");
	expect(getStage(calls[2].system, calls[2].messages) === "prose", "third call must be prose");

	for (const [index, stage] of ["state", "planner", "prose"].entries()) {
		expectHistoryIsStateClean(calls[index], stage);
	}

	const stateUserPayload = contentToText(calls[0].messages[calls[0].messages.length - 1].content);
	expect(stateUserPayload.includes("You are the state update step."), "state update instructions must be sent as user task");
	expect(stateUserPayload.includes("<previous_technical_state>"), "state update must receive previous technical state");
	expect(stateUserPayload.includes("<decoded_previous_state>"), "state update must receive decoded previous state");
	expect(stateUserPayload.includes("<current_situation>"), "state update must receive previous current_situation");
	expect(!calls[0].system.includes("You are the state update step."), "state update instructions must not be sent as system");

	const plannerUserPayload = contentToText(calls[1].messages[calls[1].messages.length - 1].content);
	expect(plannerUserPayload.includes("<current_situation>"), "planner must receive current_situation");
	expect(plannerUserPayload.includes("<gm_reasoning>"), "planner must receive reasoning structure");
	expect(!plannerUserPayload.includes("<previous_technical_state>"), "planner must not receive previous technical state");
	expect(!plannerUserPayload.includes("<decoded_previous_state>"), "planner must not receive decoded previous state");
	expect(!plannerUserPayload.includes('"r":'), "planner must not receive raw r JSON");
	expect(!plannerUserPayload.includes('"rf":'), "planner must not receive raw rf JSON");

	const proseUserPayload = contentToText(calls[2].messages[calls[2].messages.length - 1].content);
	expect(proseUserPayload.includes("<prose_execution>"), "prose instructions must be sent as user task");
	expect(proseUserPayload.includes("<current_situation>"), "prose must receive current_situation");
	expect(proseUserPayload.includes("<approved_plan>"), "prose must receive approved_plan");
	expect(!proseUserPayload.includes("<previous_technical_state>"), "prose must not receive previous technical state");
	expect(!proseUserPayload.includes("<decoded_previous_state>"), "prose must not receive decoded previous state");
	expect(!proseUserPayload.includes('"r":'), "prose must not receive raw r JSON");
	expect(!proseUserPayload.includes('"rf":'), "prose must not receive raw rf JSON");
	expect(!calls[2].system.includes("<prose_execution>"), "prose instructions must not be sent as system");

	expect(calls[0].options.temperature === 0.2, "state update temperature override changed");
	expect(calls[0].options.top_p === 0.5, "state update top_p override changed");
	expect(calls[1].options.temperature === 1, "planner temperature override changed");
	expect(calls[1].options.top_p === 0.8, "planner top_p override changed");
	expect(calls[2].options.temperature === 0.7, "prose should preserve request temperature");
	expect(calls[2].options.top_p === 0.9, "prose should preserve request top_p");
	expect(!("response_format" in calls[0].options), "state update must strip response_format");
	expect(!("stop" in calls[0].options), "state update must strip stop");

	expect(result.includes("Yaoshi looked at the cup"), "final result must include prose");
	expect(!result.includes('"bad":true'), "accidental prose state block must be stripped");
	expect(result.endsWith(
		'<state>{"date_time":"Morning","characters":{"Yaoshi":{"r":6,"rf":"FR","pr":null,"loc":"Garden","sex":false,"traits":"Calm,Curious","triggered_milestones":[]}}}</state>'
	), "final result must append exact state block from state update");
}

async function testCustomPipeline(): Promise<void> {
	const calls: StageCall[] = [];
	const result = await runCustomRpTurn(makeServices(calls), makeRequest(makeCustomMessages(), "my"));

	expect(calls.length === 2, `custom mode expected 2 stage calls, got ${calls.length}`);
	expect(getStage(calls[0].system, calls[0].messages) === "custom_planner", "custom first call must be planner");
	expect(getStage(calls[1].system, calls[1].messages) === "custom_prose", "custom second call must be prose");

	for (const [index, stage] of ["custom_planner", "custom_prose"].entries()) {
		expectHistoryIsStateClean(calls[index], stage);
	}

	const plannerSystem = calls[0].system;
	expect(plannerSystem.includes("<custom_prompt>"), "custom planner must receive custom_prompt");
	expect(plannerSystem.includes("<custom_cot>"), "custom planner must receive custom_cot");
	expect(plannerSystem.includes("<reference_material>"), "custom planner must receive reference material");
	expect(plannerSystem.indexOf("<custom_prompt>") < plannerSystem.indexOf("<reference_material>"), "custom_prompt must be above reference material");
	expect(plannerSystem.indexOf("<custom_cot>") < plannerSystem.indexOf("<reference_material>"), "custom_cot must be above reference material");
	expect(!plannerSystem.includes("<planner_canon>"), "custom planner must not receive yaoshi planner canon");
	expect(!plannerSystem.includes("<state_update_canon>"), "custom planner must not receive state update canon");

	const plannerUserPayload = contentToText(calls[0].messages[calls[0].messages.length - 1].content);
	expect(plannerUserPayload.includes("<custom_planner_stage>"), "custom planner instructions must be sent as user task");
	expect(!plannerUserPayload.includes("<current_situation>"), "custom planner must not receive current_situation");
	expect(!plannerUserPayload.includes("<previous_technical_state>"), "custom planner must not receive previous technical state");
	expect(!plannerSystem.includes("<custom_planner_stage>"), "custom planner stage instructions must not be sent as system");

	const proseSystem = calls[1].system;
	expect(proseSystem.includes("<custom_prose_instructions>"), "custom prose must receive custom_prose_instructions");
	expect(proseSystem.includes("<reference_material>"), "custom prose must receive reference material");
	expect(proseSystem.indexOf("<custom_prose_instructions>") < proseSystem.indexOf("<reference_material>"), "custom prose instructions must be above reference material");
	expect(!proseSystem.includes("<prose_canon>"), "custom prose must not receive yaoshi prose canon");

	const proseUserPayload = contentToText(calls[1].messages[calls[1].messages.length - 1].content);
	expect(proseUserPayload.includes("<custom_prose_stage>"), "custom prose instructions must be sent as user task");
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
		() => runNormalRpTurn(makeServices([], { planner: "no planner here" }), makeRequest(makeMessages())),
		"Planner step did not return a <gm_reasoning> block."
	);
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
	expect(
		legacyState.characters.Yaoshi.PR?.discovered === false,
		"legacy pr=Y must normalize to undiscovered pregnancy"
	);
	expect(legacySituation.includes("conception/pregnancy exists as technical GM truth"), "legacy pr=Y must appear in current_situation");
	expect(legacySituation.includes("Characters do not automatically know this"), "hidden pregnancy must block automatic knowledge");

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
	await testMissingPreviousState();
	await testMalformedStageOutputs();
	testPregnancyCurrentSituation();
	console.log("RP runtime fixture passed.");
}

void runRpRuntimeFixture();
