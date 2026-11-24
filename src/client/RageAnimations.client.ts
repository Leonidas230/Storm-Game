import { configureCharacterAnimations } from "./CharacterAnimationController";

configureCharacterAnimations({
	characterName: "Rage",
	rigAssetId: 86906253861216,
	idle: "rbxassetid://117870948445296",
	walk: "rbxassetid://114004021964836",
	run: "rbxassetid://87332669504020",
	jump: "rbxassetid://108150103806568",
	fall: "rbxassetid://75589881209603",
	hit: "rbxassetid://132772936557563",
	flight: {
		idle: "rbxassetid://116364601504204",
		forward: "rbxassetid://126455538396092",
		backward: "rbxassetid://118385377710183",
		left: "rbxassetid://113638609149405",
		right: "rbxassetid://84562601840746",
		attack: "rbxassetid://82865404544711",
	},
	attacks: [
		"rbxassetid://109438819892404",
		"rbxassetid://95845582515514",
		"rbxassetid://129580902538261",
	],
});
