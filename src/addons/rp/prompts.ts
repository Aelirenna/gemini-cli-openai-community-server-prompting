import { buildCharacterPlannerCanon, buildGmPlannerCanon, buildPlannerCanon, buildProseCanon } from "./canon";
import { buildCurrentSituation } from "./compiler";
import customPlannerDirectivePrompt from "./prompt_parts/custom_planner_directive.txt";
import customPlannerStagePrompt from "./prompt_parts/custom_planner_stage.txt";
import customProsePrompt from "./prompt_parts/custom_prose.txt";
import customProseStagePrompt from "./prompt_parts/custom_prose_stage.txt";
import customSystemPrompt from "./prompt_parts/custom_system_prompt.txt";
import initialStatePrompt from "./prompt_parts/initial_state.txt";
import plannerGmReasoningPrompt from "./prompt_parts/planner_gm_reasoning.txt";
import oocAnalysisPrompt from "./prompt_parts/ooc_analysis.txt";
import plannerReasoningPrompt from "./prompt_parts/planner_reasoning.txt";
import proseExecutionPrompt from "./prompt_parts/prose_execution.txt";
import stateUpdatePrompt from "./prompt_parts/state_update.txt";
import type { InitialPromptData, StagePrompt, WorldState } from "./types";

export type SceneMode = "general" | "sex";

function collectReferenceParts(initialData: InitialPromptData): string[] {
	const referenceParts: string[] = [];
	if (initialData.charPersona) {
		referenceParts.push(initialData.charPersona);
	}
	if (initialData.scenario) {
		referenceParts.push(initialData.scenario);
	}
	if (initialData.userPersona) {
		referenceParts.push(initialData.userPersona);
	}
	if (initialData.exampleDialogs) {
		referenceParts.push(initialData.exampleDialogs);
	}

	return referenceParts;
}

function buildReferenceMaterial(initialData: InitialPromptData): string {
	const referenceParts = collectReferenceParts(initialData);
	return referenceParts.length > 0 ? `<reference_material>\n${referenceParts.join("\n\n")}\n</reference_material>` : "";
}

function buildPlannerPromptSections(plannerCanon: string): string {
	return `<planner_prompt_sections>\n<planner_canon>\n${plannerCanon}\n</planner_canon>\n</planner_prompt_sections>`;
}

export function buildInitialStatePrompt(initialData: InitialPromptData, relationshipRules: string, traitDefinitions: string): StagePrompt {
	const systemParts: string[] = [];
	const referenceMaterial = buildReferenceMaterial(initialData);
	if (referenceMaterial) {
		systemParts.push(referenceMaterial);
	}
	if (relationshipRules.trim()) {
		systemParts.push(`<relationship_rules>\n${relationshipRules}\n</relationship_rules>`);
	}
	if (traitDefinitions.trim()) {
		systemParts.push(`<trait_definitions>\n${traitDefinitions}\n</trait_definitions>`);
	}

	return {
		system: systemParts.join("\n\n"),
		user: initialStatePrompt
	};
}

export function buildOocAnalysisPrompt(
	interpretedState: WorldState,
	initialData: InitialPromptData,
	promptMaterials: Record<string, string> = {}
): StagePrompt {
	const systemParts: string[] = [];
	const sceneMode = Object.values(interpretedState.characters).some((character) => character.is_sex_scene)
		? "sex"
		: "general";
	const plannerCanon = buildPlannerCanon(sceneMode);

	if (plannerCanon) {
		systemParts.push(`<planner_materials>\n${plannerCanon}\n</planner_materials>`);
	}

	const currentSituation = buildCurrentSituation(interpretedState);
	if (currentSituation) {
		systemParts.push(currentSituation);
	}

	const referenceParts: string[] = [];
	if (initialData.charPersona) {
		referenceParts.push(initialData.charPersona);
	}
	if (initialData.scenario) {
		referenceParts.push(initialData.scenario);
	}
	if (initialData.userPersona) {
		referenceParts.push(initialData.userPersona);
	}
	if (initialData.exampleDialogs) {
		referenceParts.push(initialData.exampleDialogs);
	}

	if (referenceParts.length > 0) {
		systemParts.push(`<reference_material>\n${referenceParts.join("\n\n")}\n</reference_material>`);
	}

	const promptMaterialParts = Object.entries(promptMaterials)
		.filter(([, content]) => content.trim().length > 0)
		.map(([name, content]) => `<${name}>\n${content}\n</${name}>`);

	if (promptMaterialParts.length > 0) {
		systemParts.push(`<prompt_materials>\n${promptMaterialParts.join("\n\n")}\n</prompt_materials>`);
	}

	return {
		system: systemParts.join("\n\n"),
		user: oocAnalysisPrompt
	};
}

export function getSceneMode(interpretedState: WorldState): SceneMode {
	return Object.values(interpretedState.characters).some((character) => character.is_sex_scene) ? "sex" : "general";
}

export function buildStateUpdatePrompt(
	previousStateBlock: string,
	previousState: WorldState,
	startingSituation: string,
	gmPlanBlock: string,
	characterPlanBlock: string
): StagePrompt {
	const userParts = [
		`<previous_technical_state>\n${previousStateBlock}\n</previous_technical_state>`,
		`<decoded_previous_state>\n${JSON.stringify(previousState)}\n</decoded_previous_state>`,
		startingSituation,
		`<approved_gm_plan>\n${gmPlanBlock}\n</approved_gm_plan>`,
		`<approved_character_plan>\n${characterPlanBlock}\n</approved_character_plan>`,
		"<state_finalizer_request>\nReturn exactly one updated <state> block for the written assistant prose immediately above.\n</state_finalizer_request>"
	];

	return {
		system: stateUpdatePrompt,
		user: userParts.filter((part) => part.trim().length > 0).join("\n\n")
	};
}

export function buildCustomOocAnalysisPrompt(initialData: InitialPromptData): StagePrompt {
	const systemParts = [
		`<custom_system_prompt>\n${customSystemPrompt}\n</custom_system_prompt>`,
		`<custom_planner_directive>\n${customPlannerDirectivePrompt}\n</custom_planner_directive>`,
		`<custom_prose_instructions>\n${customProsePrompt}\n</custom_prose_instructions>`
	];
	const referenceMaterial = buildReferenceMaterial(initialData);
	if (referenceMaterial) {
		systemParts.push(referenceMaterial);
	}

	return {
		system: systemParts.join("\n\n"),
		user: oocAnalysisPrompt
	};
}

export function buildPlannerPrompt(
	initialData: InitialPromptData,
	interpretedState: WorldState,
	sceneMode: SceneMode,
	gmPlanBlock: string
): StagePrompt {
	const referenceMaterial = buildReferenceMaterial(initialData);
	const systemParts = referenceMaterial ? [referenceMaterial] : [];
	const plannerPromptSections = buildPlannerPromptSections(buildCharacterPlannerCanon(sceneMode));
	const currentSituation = buildCurrentSituation(interpretedState);
	const userParts = [
		plannerReasoningPrompt,
		plannerPromptSections,
		currentSituation,
		`<approved_gm_plan>\n${gmPlanBlock}\n</approved_gm_plan>`,
		"<final_instructions>\nOutput exactly one <character_plan> block and nothing else.\n</final_instructions>"
	].filter((part) => part.trim().length > 0);

	return {
		system: systemParts.join("\n\n"),
		user: userParts.join("\n\n")
	};
}

export function buildGmPlannerPrompt(
	initialData: InitialPromptData,
	interpretedState: WorldState
): StagePrompt {
	const referenceMaterial = buildReferenceMaterial(initialData);
	const systemParts = referenceMaterial ? [referenceMaterial] : [];
	const plannerPromptSections = buildPlannerPromptSections(buildGmPlannerCanon());
	const currentSituation = buildCurrentSituation(interpretedState);
	const userParts = [
		plannerGmReasoningPrompt,
		plannerPromptSections,
		currentSituation,
		"<final_instructions>\nOutput exactly one <gm_plan> block and nothing else.\n</final_instructions>"
	].filter((part) => part.trim().length > 0);

	return {
		system: systemParts.join("\n\n"),
		user: userParts.join("\n\n")
	};
}

export function buildProsePrompt(
	initialData: InitialPromptData,
	interpretedState: WorldState,
	sceneMode: SceneMode,
	gmPlanBlock: string,
	characterPlanBlock: string
): StagePrompt {
	const systemParts = [`<prose_canon>\n${buildProseCanon(sceneMode)}\n</prose_canon>`];
	const referenceMaterial = buildReferenceMaterial(initialData);
	if (referenceMaterial) {
		systemParts.push(referenceMaterial);
	}

	const currentSituation = buildCurrentSituation(interpretedState);
	const userParts = [
		proseExecutionPrompt,
		currentSituation,
		`<approved_plan>\n<approved_gm_plan>\n${gmPlanBlock}\n</approved_gm_plan>\n\n<approved_character_plan>\n${characterPlanBlock}\n</approved_character_plan>\n</approved_plan>`
	].filter((part) => part.trim().length > 0);

	return {
		system: systemParts.join("\n\n"),
		user: userParts.join("\n\n")
	};
}

export function buildCustomPlannerPrompt(initialData: InitialPromptData): StagePrompt {
	const systemParts = [
		`<custom_system_prompt>\n${customSystemPrompt}\n</custom_system_prompt>`,
		`<custom_planner_directive>\n${customPlannerDirectivePrompt}\n</custom_planner_directive>`
	];
	const referenceMaterial = buildReferenceMaterial(initialData);
	if (referenceMaterial) {
		systemParts.push(referenceMaterial);
	}

	return {
		system: systemParts.join("\n\n"),
		user: customPlannerStagePrompt
	};
}

export function buildCustomProsePrompt(initialData: InitialPromptData, reasoningBlock: string): StagePrompt {
	const systemParts = [
		`<custom_prose_instructions>\n${customProsePrompt}\n</custom_prose_instructions>`
	];
	const referenceMaterial = buildReferenceMaterial(initialData);
	if (referenceMaterial) {
		systemParts.push(referenceMaterial);
	}

	return {
		system: systemParts.join("\n\n"),
		user: [
			customProseStagePrompt,
			`<approved_plan>\n${reasoningBlock}\n</approved_plan>`,
		].join("\n\n")
	};
}
