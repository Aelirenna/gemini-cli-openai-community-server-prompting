import type { CharacterState } from "./types";

export interface Milestone {
	name: string;
	gate: number;
	rf: "LV" | "FR";
	requirement: string;
}

export const relationshipGates: Milestone[] = [
	{
		name: "BREAK_THE_ICE_LV",
		gate: -1,
		rf: "LV",
		requirement:
			"The Enemy-to-Pull Crack: {{char}} no longer experiences this as simple hostility. The pull has become internal, difficult to fight, and no longer entirely unwanted. It should begin reaching {{user}} as perceivable behavior: hesitation where hostility would have been easy, a charged refusal to look away, unexpected restraint, unwanted softness, or a direct or indirect sign that the conflict is no longer only hate."
	},
	{
		name: "INTEREST_DECLARATION_LV",
		gate: 80,
		rf: "LV",
		requirement:
			"The Interest Signal: {{char}} starts to see {{user}} as potentially special. This does not require blunt confession. It should surface as human courtship or interest: seeking time together, attention that is no longer casual, a personal question, a playful or awkward hint, a small gesture, or a vulnerable opening that lets {{user}} perceive interest. The milestone is about making the interest observable, regardless of reciprocation."
	},
	{
		name: "ROMANCE_CONFESSION_LV",
		gate: 111,
		rf: "LV",
		requirement:
			"The Crossing Point: {{char}}'s romantic feeling has become serious enough that keeping it only internal no longer fits. They should look for a natural opportunity to make this seriousness perceivable through direct words, a definitive gesture, a vulnerable admission, or a choice that clearly changes how they approach {{user}}. The milestone is triggered by the expression, regardless of reciprocation."
	},
	{
		name: "DEEP_DEVOTION_LV",
		gate: 161,
		rf: "LV",
		requirement:
			"The Future-Bonding: {{char}} starts to think of {{user}} as part of their long-term life and self-understanding. They should let this become visible through a concrete choice, trust, shared risk, future planning, protection, or vulnerability that belongs to the current story."
	},
	{
		name: "SOULMATE_BOND_LV",
		gate: 196,
		rf: "LV",
		requirement:
			"The Soulmate Bond: {{char}} experiences {{user}} as central to their future and inner life. This should become visible through a profound but human commitment: chosen loyalty, a life-shaping decision, deep vulnerability, a promise that costs something, or a concrete act of care that keeps {{char}}, {{user}}, and the surrounding world real."
	},
	{
		name: "CEASE_HOSTILITY_FR",
		gate: -1,
		rf: "FR",
		requirement:
			"The Truce: {{char}} allows the relationship to move out of simple dislike or opposition. They should make a neutral, cooperative, or helpful moment perceivable to {{user}}, while any remaining distrust or conflict can still exist."
	},
	{
		name: "FRIENDSHIP_SPARK_FR",
		gate: 31,
		rf: "FR",
		requirement:
			"The Friendly Connection: {{char}} finds {{user}}'s company genuinely pleasant. They should reach out in a visible way that shows they value the interaction itself: starting a non-essential conversation, offering company, including {{user}}, or choosing a small shared activity."
	},
	{
		name: "TRUST_ESTABLISHED_FR",
		gate: 91,
		rf: "FR",
		requirement:
			"The Solid Bond: {{char}} trusts {{user}} enough for the bond to affect choices. They should demonstrate this through something {{user}} can perceive: relying on them, sharing a real concern, asking for support, protecting shared trust, or choosing honesty where distance would have been easier."
	},
	{
		name: "BEST_FRIEND_LOYALTY_FR",
		gate: 151,
		rf: "FR",
		requirement:
			"The Inner Circle: {{char}} treats {{user}} as one of their most trusted people. This loyalty should be visible in how they prioritize, defend, include, protect, rely on, or make room for {{user}} when it matters in the story."
	},
	{
		name: "FOUND_FAMILY_FR",
		gate: 196,
		rf: "FR",
		requirement:
			'The Chosen Family: {{char}} accepts {{user}} as "family" in the platonic sense. This should become visible through chosen-family loyalty, trust, shared belonging, putting pride aside, offering protection or home, or making a concrete choice that shows {{user}} has a lasting place in {{char}}\'s life.'
	}
];

export const regressionGates: Milestone[] = [
	{
		name: "REGRESSION_LV_196",
		gate: 196,
		rf: "LV",
		requirement:
			"The Drift: {{char}} feels the highest romantic bond under strain. This should show through a changed choice, visible pain, guardedness, hesitation, distance, or direct conversation that belongs to the recent played cause."
	},
	{
		name: "REGRESSION_LV_161",
		gate: 161,
		rf: "LV",
		requirement:
			"Diminishing Certainty: {{char}}'s long-term confidence in the bond is weakening. They may become less ready to include {{user}} in future choices, more guarded with vulnerability, or more aware of unresolved distance between them."
	},
	{
		name: "REGRESSION_LV_111",
		gate: 111,
		rf: "LV",
		requirement:
			"The Crisis: {{char}} doubts where the romantic bond stands. They should express or act on a need for clarity, distance, repair, or honesty because the previous closeness no longer feels certain."
	},
	{
		name: "REGRESSION_LV_80",
		gate: 80,
		rf: "LV",
		requirement:
			"Romantic Cooling: The early romantic fixation is fading. {{char}} should show less pursuit, less flirtation, less emotional availability, or a cooler stance in a way that follows from what happened."
	},
	{
		name: "REGRESSION_LV_-1",
		gate: -1,
		rf: "LV",
		requirement:
			"Resurfacing Friction: The conflicted pull is no longer enough to soften the negative lens. {{char}} should show renewed distrust, hurt, resentment, disagreement, or distance without reducing {{user}} to a body, prize, threat, or faceless opponent."
	},
	{
		name: "REGRESSION_FR_196",
		gate: 196,
		rf: "FR",
		requirement:
			"Family Bond Fraying: {{char}} feels the chosen-family bond under strain. They should show loss, grief, guardedness, changed trust, or tighter boundaries in response to the played cause."
	},
	{
		name: "REGRESSION_FR_151",
		gate: 151,
		rf: "FR",
		requirement:
			"Losing Priority: {{char}}'s deep platonic loyalty is wavering. They should show less willingness to prioritize, rely on, defend, include, or make room for {{user}} where they previously would have."
	},
	{
		name: "REGRESSION_FR_91",
		gate: 91,
		rf: "FR",
		requirement:
			"Trust Erosion: The foundation of friendship feels compromised. {{char}} should show disappointment, guardedness, hesitation to rely on {{user}}, or a need for repair."
	},
	{
		name: "REGRESSION_FR_31",
		gate: 31,
		rf: "FR",
		requirement:
			"Platonic Cooling: {{char}} finds less ease or joy in {{user}}'s company. They should show less voluntary contact, less warmth, more distance, or a more practical/professional tone."
	},
	{
		name: "REGRESSION_FR_-1",
		gate: -1,
		rf: "FR",
		requirement:
			"The Truce Ends: Neutrality or cooperation has failed. {{char}} should show renewed dislike, distrust, resentment, distance, or opposition in a way that follows from the played reality."
	}
];

export const checkMilestones = (charState: CharacterState): { name: string; prompt: string } | null => {
	if (charState.R === undefined || charState.RF === undefined) {
		return null;
	}

	const r = charState.R;
	const rf = charState.RF;
	const triggered = charState.triggered_milestones || [];

	const upwardCandidates = relationshipGates.filter((milestone) => {
		const isMatchingPath = milestone.rf === rf;
		const isLevelReached = r >= milestone.gate;
		const isNotYetTriggered = !triggered.includes(milestone.name);
		const hasHigherTriggered = relationshipGates.some(
			(higher) => higher.rf === rf && higher.gate > milestone.gate && triggered.includes(higher.name)
		);
		const freshnessBuffer = 10;
		const isOldNews = triggered.length === 0 && r >= milestone.gate + freshnessBuffer;

		return isMatchingPath && isLevelReached && isNotYetTriggered && !hasHigherTriggered && !isOldNews;
	});

	if (upwardCandidates.length > 0) {
		const milestone = upwardCandidates.reduce((previous, current) =>
			previous.gate > current.gate ? previous : current
		);
		return {
			name: milestone.name,
			prompt:
				`[THEMATIC EVOLUTION: ${milestone.name}]\n` +
				`CURRENT THEME: ${milestone.requirement}\n` +
				"PLANNER INSTRUCTION: Treat this as an active relationship branch to bring into play soon, at the nearest natural human opportunity. Do not let it sit as background until the relationship has already advanced to the next milestone. If the current moment naturally allows it, plan a clear action, statement, gesture, or behavioral shift {{user}} can perceive. If the moment does not allow it, move the scene toward a natural opportunity instead of burying the line as internal-only narration. Internal thought alone does not complete the milestone.\n" +
				`COMPLETION LOGIC: "${milestone.name}" is completed only after {{char}} observably initiates or expresses this dynamic to {{user}} in played reality. The planner does not edit state; state update records completion after the observable expression exists. Do not plan repeated initiation after completion unless the character and circumstances genuinely justify persistence.`
		};
	}

	const downwardCandidates = regressionGates.filter((regression) => {
		const relatedUpgrade = relationshipGates.find(
			(milestone) => milestone.gate === regression.gate && milestone.rf === regression.rf
		);
		return (
			relatedUpgrade &&
			triggered.includes(relatedUpgrade.name) &&
			r < regression.gate &&
			!triggered.includes(regression.name) &&
			!regressionGates.some(
				(lower) => lower.rf === rf && lower.gate < regression.gate && lower.gate > r && triggered.includes(lower.name)
			)
		);
	});

	if (downwardCandidates.length > 0) {
		const regression = downwardCandidates.reduce((previous, current) =>
			previous.gate < current.gate ? previous : current
		);
		return {
			name: regression.name,
			prompt:
				"[RELATIONSHIP DYNAMIC SHIFT]\n" +
				`NARRATIVE DIRECTION: ${regression.requirement}\n` +
				"PLANNER INSTRUCTION: Treat this as a natural consequence of recent played development. Express it through behavior that belongs to this person and situation, not through a sudden trope reset.\n" +
				`COMPLETION LOGIC: "${regression.name}" is completed only after the shift has become observably established in played reality. The planner does not edit state; state update records completion after the observable shift exists.`
		};
	}

	return null;
};
