import { buildPlannerCanon, buildProseCanon, buildStateUpdateCanon } from "./canon";
import { buildCurrentSituation } from "./compiler";
import customCotPrompt from "./prompt_parts/custom_cot.txt";
import customPlannerStagePrompt from "./prompt_parts/custom_planner_stage.txt";
import customPrompt from "./prompt_parts/custom_prompt.txt";
import customProsePrompt from "./prompt_parts/custom_prose.txt";
import customProseStagePrompt from "./prompt_parts/custom_prose_stage.txt";
import initialStatePrompt from "./prompt_parts/initial_state.txt";
import oocAnalysisPrompt from "./prompt_parts/ooc_analysis.txt";
import plannerNsfwScenePrompt from "./prompt_parts/planner_nsfw_scene.txt";
import plannerReasoningPrompt from "./prompt_parts/planner_reasoning.txt";
import plannerStoryMovementPrompt from "./prompt_parts/planner_story_movement.txt";
import proseExecutionPrompt from "./prompt_parts/prose_execution.txt";
import stateUpdatePrompt from "./prompt_parts/state_update.txt";
import type { InitialPromptData, StagePrompt, WorldState } from "./types";

export type SceneMode = "general" | "sex";

function fillTemplate(template: string, values: Record<string, string>): string {
	return Object.entries(values).reduce((result, [key, value]) => result.replaceAll(`{{${key}}}`, value), template);
}

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
	initialData: InitialPromptData,
	previousStateBlock: string,
	previousState: WorldState,
	previousSituation: string
): StagePrompt {
	const systemParts = [
		`<state_update_canon>\n${buildStateUpdateCanon()}\n</state_update_canon>`
	];
	const referenceMaterial = buildReferenceMaterial(initialData);
	if (referenceMaterial) {
		systemParts.push(referenceMaterial);
	}

	const userParts = [
		stateUpdatePrompt,
		`<previous_technical_state>\n${previousStateBlock}\n</previous_technical_state>`,
		`<decoded_previous_state>\n${JSON.stringify(previousState)}\n</decoded_previous_state>`
	];

	if (previousSituation) {
		userParts.push(previousSituation);
	}

	return {
		system: systemParts.join("\n\n"),
		user: userParts.join("\n\n")
	};
}

export function buildPlannerPrompt(
	initialData: InitialPromptData,
	interpretedState: WorldState,
	sceneMode: SceneMode
): StagePrompt {
	const systemParts = [`<planner_canon>\n${buildPlannerCanon(sceneMode)}\n</planner_canon>`];
	const referenceMaterial = buildReferenceMaterial(initialData);
	if (referenceMaterial) {
		systemParts.push(referenceMaterial);
	}

	const currentSituation = buildCurrentSituation(interpretedState);
	const scenePlanSection = sceneMode === "sex" ? plannerNsfwScenePrompt : plannerStoryMovementPrompt;
	const plannerReasoning = fillTemplate(plannerReasoningPrompt, {
		SCENE_PLAN_SECTION: scenePlanSection
	});
	const userParts = [
		currentSituation,
		plannerReasoning,
		"<final_instructions>\nOutput exactly one <gm_reasoning> block and nothing else.\n</final_instructions>"
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
	reasoningBlock: string
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
		`<approved_plan>\n${reasoningBlock}\n</approved_plan>`
	].filter((part) => part.trim().length > 0);

	return {
		system: systemParts.join("\n\n"),
		user: userParts.join("\n\n")
	};
}

export function buildCustomPlannerPrompt(initialData: InitialPromptData): StagePrompt {
	const systemParts = [
		`<custom_prompt>\n${customPrompt}\n</custom_prompt>`,
		`<custom_cot>\n${customCotPrompt}\n</custom_cot>`
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
