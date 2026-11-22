const player = game.GetService("Players").LocalPlayer;
const replicatedStorage = game.GetService("ReplicatedStorage");
const abilityEvent = replicatedStorage.WaitForChild("UseCharacterAbility") as RemoteEvent;

const connectedTools = new Set<Tool>();
const Workspace = game.GetService("Workspace");

function playAttackAnimation(character: Model): void {
	const selectedCharacter = player.GetAttribute("SelectedCharacter");
	if (selectedCharacter === "Rage" || selectedCharacter === "Flood" || selectedCharacter === "Rain") {
		const request = character.GetAttribute("AttackAnimationRequest");
		const nextRequest = typeIs(request, "number") ? request + 1 : 1;
		character.SetAttribute("AttackAnimationRequest", nextRequest);
	}
}

function bindTool(instance: Instance): void {
	if (!instance.IsA("Tool") || connectedTools.has(instance)) {
		return;
	}

	if (instance.Name !== "Sword" && instance.Name !== "Bow") {
		return;
	}

	connectedTools.add(instance);
	instance.Activated.Connect(() => {
		if (player.Character) {
			playAttackAnimation(player.Character);
		}

		const camera = Workspace.CurrentCamera;
		if (!camera) {
			warn("Cannot use the character ability because the camera is unavailable.");
			return;
		}

		abilityEvent.FireServer(instance.Name, camera.CFrame.LookVector);
	});
}

const backpack = player.WaitForChild("Backpack") as Backpack;
backpack.GetChildren().forEach(bindTool);
backpack.ChildAdded.Connect(bindTool);

player.CharacterAdded.Connect((character) => {
	character.GetChildren().forEach(bindTool);
	character.ChildAdded.Connect(bindTool);
});

if (player.Character) {
	player.Character.GetChildren().forEach(bindTool);
}
