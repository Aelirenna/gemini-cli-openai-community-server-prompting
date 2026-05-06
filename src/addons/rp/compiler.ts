import type { ChatMessage } from "../../types";
import { checkMilestones } from "./milestones";
import relationshipRulesContentText from "./prompt_parts/relationship_rules.txt";
import traitDefinitionsText from "./prompt_parts/traits_definitions.txt";
import type { CharacterState, InitialPromptData, Rules, WorldState } from "./types";

export const relationshipRulesContent = relationshipRulesContentText;
export const traitDefinitions = traitDefinitionsText;

export const parseRules = (rulesContent: string): Rules => {
	const rules: Rules = { rLevels: [], rfFlags: {} };
	const lines = rulesContent.split("\n").filter((line) => line.trim().length > 0);
	let currentSection: "R_LEVELS" | "RF_FLAGS" | null = null;

	for (const line of lines) {
		const trimmedLine = line.trim();
		if (trimmedLine.startsWith("[R_LEVELS]")) {
			currentSection = "R_LEVELS";
			continue;
		}
		if (trimmedLine.startsWith("[RF_FLAGS]")) {
			currentSection = "RF_FLAGS";
			continue;
		}
		if (!currentSection) {
			continue;
		}
		if (currentSection === "R_LEVELS") {
			const parts = trimmedLine.split(/:\s*/);
			if (parts.length < 2) {
				continue;
			}
			const key = parts[0];
			const description = parts.slice(1).join(": ");
			const flagMatch = key.match(/_([A-Z]+)$/);
			const flag = flagMatch ? flagMatch[1] : null;
			const rangeKey = flag ? key.replace(`_${flag}`, "") : key;
			const rangeMatch = rangeKey.match(/^(-?\d+)-(-?\d+)$/);
			const exactMatch = rangeKey.match(/^(-?\d+)$/);
			let parsedRange: [number, number] | null = null;
			if (rangeMatch) {
				parsedRange = [parseInt(rangeMatch[1]), parseInt(rangeMatch[2])];
			} else if (exactMatch) {
				parsedRange = [parseInt(exactMatch[1]), parseInt(exactMatch[1])];
			}
			if (parsedRange) {
				rules.rLevels.push({ range: parsedRange, description, flags: flag ? [flag] : undefined });
			}
		} else if (currentSection === "RF_FLAGS") {
			const parts = trimmedLine.split(/:\s*/);
			if (parts.length === 2) {
				rules.rfFlags[parts[0]] = parts[1];
			}
		}
	}

	return rules;
};

export const parseTraitDefinitions = (definitionsContent: string): Map<string, string> => {
	const definitions = new Map<string, string>();
	const lines = definitionsContent.split("\n").filter((line) => line.trim().length > 0);

	for (const line of lines) {
		const parts = line.split(/:\s*/);
		if (parts.length >= 2) {
			const key = parts[0].trim();
			const description = parts.slice(1).join(":").trim();
			definitions.set(key, description);
		}
	}

	return definitions;
};

export const interpretState = (worldState: WorldState, rules: Rules): WorldState => {
	const interpretedState = JSON.parse(JSON.stringify(worldState)) as WorldState;
	for (const charName in interpretedState.characters) {
		const charState = interpretedState.characters[charName];
		if (charState.R !== undefined && charState.RF !== undefined) {
			let foundDescription = "Unknown relationship level.";
			const sortedLevels = [...rules.rLevels].sort((a, b) => a.range[0] - b.range[0]);
			const relevantLevels = sortedLevels.filter((level) => !level.flags || level.flags.includes(charState.RF!));

			if (relevantLevels.length > 0) {
				const exactMatch = relevantLevels.find(
					(level) => charState.R! >= level.range[0] && charState.R! <= level.range[1]
				);

				if (exactMatch) {
					foundDescription = exactMatch.description;
				} else {
					const minLevel = relevantLevels[0];
					const maxLevel = relevantLevels[relevantLevels.length - 1];

					if (charState.R! < minLevel.range[0]) {
						foundDescription = minLevel.description;
					} else if (charState.R! > maxLevel.range[1]) {
						foundDescription = maxLevel.description;
					}
				}
			}

			charState.relationship_description = foundDescription;
			charState.relationship_trend = rules.rfFlags[charState.RF] || "Unknown relationship type.";
		}
	}

	return interpretedState;
};

// Keep this parser intentionally close to the original fork because alternate
// "cleanups" regressed on real-world state formats.
function findPreviousStateMatch(messages: ChatMessage[]): RegExpMatchArray | null {
	for (const message of [...messages].reverse()) {
		if (message.role !== "assistant" || typeof message.content !== "string") {
			continue;
		}

		const stateMatch = message.content.match(/<state>\s*(.*?)\s*<\/state>/s);
		if (stateMatch) {
			return stateMatch;
		}
	}

	return null;
}

export const extractPreviousState = (messages: ChatMessage[]): WorldState => {
	const worldState: WorldState = { characters: {} };
	const stateMatch = findPreviousStateMatch(messages);

	if (!stateMatch || !stateMatch[1]) {
		return worldState;
	}

	try {
		const stateJson = stateMatch[1];
		const parsedJson = JSON.parse(stateJson) as {
			date_time?: string;
			characters?: Record<
				string,
				{
					r?: number;
					rf?: string;
					pr?:
						| { target?: string; isPregnant?: "Y" | "N"; discovered?: boolean; conceived_at?: string; discovered_at?: string }
						| "Y"
						| "N"
						| boolean;
					loc?: string;
					sex?: boolean;
					traits?: string;
					triggered_milestones?: string[];
				}
			>;
			threads?: string;
		};

		if (parsedJson.date_time) {
			worldState.dateTime = parsedJson.date_time;
		}

		if (parsedJson.characters) {
			for (const charName in parsedJson.characters) {
				const charData = parsedJson.characters[charName];
				const pregnancyState: CharacterState["PR"] =
					typeof charData.pr === "string"
						? charData.pr === "Y"
							? { isPregnant: "Y", discovered: false }
							: undefined
						: typeof charData.pr === "boolean"
							? charData.pr
								? { isPregnant: "Y", discovered: false }
								: undefined
							: charData.pr?.isPregnant === "Y" && charData.pr.discovered === undefined
								? { ...charData.pr, discovered: false }
								: charData.pr;
				worldState.characters[charName] = {
					R: charData.r,
					RF: charData.rf,
					PR: pregnancyState,
					location: charData.loc,
					is_sex_scene: charData.sex,
					traits: charData.traits,
					triggered_milestones: charData.triggered_milestones
				};
			}
		}

		if (typeof parsedJson.threads === "string") {
			worldState.threads = parsedJson.threads;
		}
	} catch (error) {
		console.error("--- DEBUG: Failed to parse state JSON. Content was:", stateMatch[1], "Error:", error);
		return { characters: {} };
	}

	return worldState;
};

export const extractPreviousStateBlock = (messages: ChatMessage[]): string => {
	return findPreviousStateMatch(messages)?.[0] ?? "";
};

export const parseInitialPrompt = (systemContent: string): InitialPromptData => {
	const data: InitialPromptData = {};
	const personaMatch = systemContent.match(/<.*?'s Persona>[\s\S]*?<\/.*?'s Persona>/i);
	if (personaMatch) {
		data.charPersona = personaMatch[0];
	}
	const scenarioMatch = systemContent.match(/<Scenario>[\s\S]*?<\/Scenario>/i);
	if (scenarioMatch) {
		data.scenario = scenarioMatch[0];
	}
	const userPersonaMatch = systemContent.match(/<UserPersona>[\s\S]*?<\/UserPersona>/i);
	if (userPersonaMatch) {
		data.userPersona = userPersonaMatch[0];
	}
	const exampleDialogsMatch = systemContent.match(/<example_dialogs>[\s\S]*?<\/example_dialogs>/i);
	if (exampleDialogsMatch) {
		data.exampleDialogs = exampleDialogsMatch[0];
	}
	return data;
};

function formatPregnancyStatus(charState: CharacterState): string | null {
	if (charState.PR?.isPregnant !== "Y") {
		return null;
	}

	const target = charState.PR.target ? ` Target: ${charState.PR.target}.` : "";
	const conceivedAt = charState.PR.conceived_at ? ` Conceived around: ${charState.PR.conceived_at}.` : "";
	const discoveredAt = charState.PR.discovered_at ? ` Discovered at: ${charState.PR.discovered_at}.` : "";
	if (charState.PR.discovered) {
		return `Pregnancy: conception/pregnancy exists as technical GM truth and is known in played reality.${target}${conceivedAt}${discoveredAt}`;
	}

	return `Pregnancy: conception/pregnancy exists as technical GM truth, but it has not been discovered in played reality.${target}${conceivedAt} Characters do not automatically know this from the technical state. After enough natural in-world time passes, the story should create a plausible discovery path instead of forgetting it or revealing it immediately.`;
}

function wrapCurrentSituation(situation: string): string {
	return situation.trim() ? `<current_situation>\n${situation.trim()}\n</current_situation>` : "";
}

function appendSharedSituationHeader(interpretedState: WorldState): string {
	let situation = "";

	if (interpretedState.dateTime) {
		situation += `In-world time: ${interpretedState.dateTime}\n`;
	}

	if (interpretedState.threads) {
		situation += `Long-story threads (memory, not a command queue): ${interpretedState.threads}\n`;
	}

	return situation;
}

export const buildCurrentSituation = (interpretedState: WorldState): string => {
	const traitDefs = parseTraitDefinitions(traitDefinitions);
	let situation = appendSharedSituationHeader(interpretedState);

	if (Object.keys(interpretedState.characters).length > 0) {
		for (const charName in interpretedState.characters) {
			const charState = interpretedState.characters[charName];
			let statusString = `For ${charName}:`;
			if (charState.relationship_description) {
				statusString += `\n- Attitude towards the {{user}}: ${charState.relationship_description} (${charState.relationship_trend})`;
			}
			if (charState.location) {
				statusString += `\n- Location: ${charState.location}`;
			}
			const pregnancyStatus = formatPregnancyStatus(charState);
			if (pregnancyStatus) {
				statusString += `\n- ${pregnancyStatus}`;
			}
			if (charState.traits) {
				let traitsWithDefs = charState.traits;
				for (const [trait, definition] of traitDefs.entries()) {
					const regex = new RegExp(`\\b${trait}\\b`, "gi");
					traitsWithDefs = traitsWithDefs.replace(regex, `${trait} (${definition})`);
				}
				statusString += `\n- Traits: ${traitsWithDefs}`;
			}

			const milestone = checkMilestones(charState);
			if (milestone) {
				statusString += `\n- THEMATIC FOCUS: ${milestone.prompt}`;
			}

			situation += statusString + "\n";
		}
	}

	return wrapCurrentSituation(situation);
};

export const buildGmCurrentSituation = (interpretedState: WorldState): string => {
	let situation = appendSharedSituationHeader(interpretedState);

	if (Object.keys(interpretedState.characters).length > 0) {
		for (const charName in interpretedState.characters) {
			const charState = interpretedState.characters[charName];
			const statusLines: string[] = [];
			if (charState.location) {
				statusLines.push(`Location: ${charState.location}`);
			}
			const pregnancyStatus = formatPregnancyStatus(charState);
			if (pregnancyStatus) {
				statusLines.push(pregnancyStatus);
			}
			if (charState.is_sex_scene) {
				statusLines.push("Sex scene: active");
			}

			if (statusLines.length > 0) {
				situation += `For ${charName}:\n- ${statusLines.join("\n- ")}\n`;
			}
		}
	}

	return wrapCurrentSituation(situation);
};
