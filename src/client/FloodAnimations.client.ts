import { configureCharacterAnimations } from "./CharacterAnimationController";

configureCharacterAnimations({
	characterName: "Flood",
	rigAssetId: 126251167185079,
	idle: "rbxassetid://86401936157217",
	walk: "rbxassetid://130001828696595",
	run: "rbxassetid://107035105054208",
	jump: "rbxassetid://72351633108358",
	fall: "rbxassetid://83344063770747",
	hit: "rbxassetid://84875243422027",
	flight: {
		idle: "rbxassetid://99299008474090",
		forward: "rbxassetid://129357378212454",
		backward: "rbxassetid://115335026279337",
		left: "rbxassetid://121941638005696",
		right: "rbxassetid://88067842903619",
		attack: "rbxassetid://118180389483978",
	},
	attacks: [
		"rbxassetid://117804197292864",
		"rbxassetid://104798264331406",
		"rbxassetid://113694373844766",
	],
});
