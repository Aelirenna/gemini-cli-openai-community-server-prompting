export interface CharacterState {
	R?: number;
	RF?: string;
	PR?: {
		target?: string;
		isPregnant?: "Y" | "N";
		discovered?: boolean;
		conceived_at?: string;
		discovered_at?: string;
	};
	location?: string;
	is_sex_scene?: boolean;
	traits?: string;
	relationship_description?: string;
	relationship_trend?: string;
	triggered_milestones?: string[];
}

export type WorldState = {
	dateTime?: string;
	characters: {
		[charName: string]: CharacterState;
	};
};

export type Rules = {
	rLevels: { range: [number, number]; description: string; flags?: string[] }[];
	rfFlags: { [key: string]: string };
};

export type InitialPromptData = {
	charPersona?: string;
	scenario?: string;
	userPersona?: string;
	exampleDialogs?: string;
};

export interface StagePrompt {
	system: string;
	user: string;
}
