import { configureCharacterAnimations } from "./CharacterAnimationController";

configureCharacterAnimations({
	characterName: "Rain",
	rigAssetId: 76860276062667,
	idle: "rbxassetid://139104188775146",
	walk: "rbxassetid://137439274423743",
	run: "rbxassetid://135678405507133",
	jump: "rbxassetid://98461505921588",
	fall: "rbxassetid://74166433007369",
	hit: "rbxassetid://81388825843766",
	flight: {
		idle: "rbxassetid://73313040479978",
		forward: "rbxassetid://77689907707165",
		backward: "rbxassetid://103782264701615",
		left: "rbxassetid://101945283304603",
		right: "rbxassetid://121475192807567",
		attack: "rbxassetid://135093267308205",
	},
	attacks: ["rbxassetid://79498206410937"],
});
