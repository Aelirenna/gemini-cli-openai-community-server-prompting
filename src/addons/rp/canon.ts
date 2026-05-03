import canonPreservation from "./prompt_parts/canon_preservation.txt";

const CANON_HEADING_REGEX = /^#\s+(.+)$/gm;
const PLANNER_CANON_SECTIONS = [
	"Contract",
	"Main",
	"Role separation",
	"Metacare",
	"The long game",
	"Playing & portrayal",
	"Prohibitions",
	"Physical logic"
];
const GM_PLANNER_CANON_SECTIONS = ["Contract", "Main", "Role separation", "Metacare", "The long game", "Prohibitions"];
const CHARACTER_PLANNER_CANON_SECTIONS = ["Contract", "Main", "Metacare", "Playing & portrayal", "Prohibitions"];
const PROSE_CANON_SECTIONS = ["Contract", "Writing", "Physical logic", "Playing & portrayal", "Prohibitions"];
const STATE_UPDATE_CANON_SECTIONS = ["Contract", "Playing & portrayal", "Prohibitions"];

export function getCanonSection(title: string): string {
	const matches = [...canonPreservation.matchAll(CANON_HEADING_REGEX)];
	const sectionStart = matches.find((match) => match[1].trim() === title);

	if (!sectionStart || sectionStart.index === undefined) {
		return "";
	}

	const nextSection = matches.find((match) => (match.index ?? 0) > sectionStart.index!);
	const start = sectionStart.index;
	const end = nextSection?.index ?? canonPreservation.length;

	return canonPreservation.slice(start, end).trim();
}

export function buildCanonSections(titles: string[]): string {
	return titles
		.map((title) => getCanonSection(title))
		.filter((section) => section.length > 0)
		.join("\n\n");
}

export function buildPlannerCanon(sceneMode: "general" | "sex"): string {
	const sections = sceneMode === "sex" ? [...PLANNER_CANON_SECTIONS, "NSFW"] : PLANNER_CANON_SECTIONS;
	return buildCanonSections(sections);
}

export function buildGmPlannerCanon(): string {
	return buildCanonSections(GM_PLANNER_CANON_SECTIONS);
}

export function buildCharacterPlannerCanon(sceneMode: "general" | "sex"): string {
	const sections = sceneMode === "sex" ? [...CHARACTER_PLANNER_CANON_SECTIONS, "NSFW"] : CHARACTER_PLANNER_CANON_SECTIONS;
	return buildCanonSections(sections);
}

export function buildProseCanon(sceneMode: "general" | "sex"): string {
	const sections = sceneMode === "sex" ? [...PROSE_CANON_SECTIONS, "NSFW"] : PROSE_CANON_SECTIONS;
	return buildCanonSections(sections);
}

export function buildStateUpdateCanon(): string {
	return buildCanonSections(STATE_UPDATE_CANON_SECTIONS);
}
