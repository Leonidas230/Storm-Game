const player = game.GetService("Players").LocalPlayer;
const playerGui = player.WaitForChild("PlayerGui") as PlayerGui;

const existingGui = playerGui.FindFirstChild("DiveChargeGui");
existingGui?.Destroy();

const screenGui = new Instance("ScreenGui");
screenGui.Name = "DiveChargeGui";
screenGui.ResetOnSpawn = false;
screenGui.DisplayOrder = 20;
screenGui.Parent = playerGui;

const container = new Instance("Frame");
container.Name = "ChargeContainer";
container.AnchorPoint = new Vector2(0.5, 0.5);
container.Position = UDim2.fromScale(0.5, 0.82);
container.Size = UDim2.fromOffset(336, 64);
container.BackgroundColor3 = Color3.fromRGB(20, 25, 36);
container.BackgroundTransparency = 0.12;
container.BorderSizePixel = 0;
container.Visible = false;
container.Parent = screenGui;

const containerCorner = new Instance("UICorner");
containerCorner.CornerRadius = new UDim(0, 10);
containerCorner.Parent = container;

const label = new Instance("TextLabel");
label.Name = "ChargeLabel";
label.Position = UDim2.fromOffset(16, 6);
label.Size = UDim2.fromOffset(304, 20);
label.BackgroundTransparency = 1;
label.Font = Enum.Font.GothamBold;
label.Text = "DIVE CHARGE 0%";
label.TextColor3 = Color3.fromRGB(235, 240, 250);
label.TextSize = 14;
label.TextXAlignment = Enum.TextXAlignment.Left;
label.Parent = container;

const barTrack = new Instance("Frame");
barTrack.Name = "BarTrack";
barTrack.Position = UDim2.fromOffset(16, 34);
barTrack.Size = UDim2.fromOffset(304, 14);
barTrack.BackgroundColor3 = Color3.fromRGB(55, 62, 76);
barTrack.BorderSizePixel = 0;
barTrack.ClipsDescendants = true;
barTrack.Parent = container;

const barTrackCorner = new Instance("UICorner");
barTrackCorner.CornerRadius = new UDim(1, 0);
barTrackCorner.Parent = barTrack;

const barFill = new Instance("Frame");
barFill.Name = "BarFill";
barFill.Size = UDim2.fromScale(0, 1);
barFill.BackgroundColor3 = Color3.fromRGB(75, 151, 255);
barFill.BorderSizePixel = 0;
barFill.Parent = barTrack;

const barFillCorner = new Instance("UICorner");
barFillCorner.CornerRadius = new UDim(1, 0);
barFillCorner.Parent = barFill;

let activeCharacter: Model | undefined;
let attributeConnections: RBXScriptConnection[] = [];

function updateChargeDisplay(): void {
	const selectedCharacter = player.GetAttribute("SelectedCharacter");
	const isPlayableCharacter =
		selectedCharacter === "Rage" || selectedCharacter === "Flood" || selectedCharacter === "Rain";
	if (!activeCharacter || player.Character !== activeCharacter || !isPlayableCharacter) {
		container.Visible = false;
		return;
	}

	const isCharging = activeCharacter.GetAttribute("FlyChargeActive") === true;
	const isDiving = activeCharacter.GetAttribute("FlyDiveActive") === true;
	const progressAttribute = activeCharacter.GetAttribute("FlyChargeProgress");
	const progress = typeIs(progressAttribute, "number") ? math.clamp(progressAttribute, 0, 1) : 0;
	if (!isCharging && !isDiving) {
		container.Visible = false;
		return;
	}

	container.Visible = true;
	barFill.Size = UDim2.fromScale(isDiving ? 1 : progress, 1);
	const isReady = isDiving || progress >= 1;
	label.Text = isReady ? "DIVE READY!" : `DIVE CHARGE ${math.floor(progress * 100)}%`;
	barFill.BackgroundColor3 = isReady
		? Color3.fromRGB(83, 210, 135)
		: Color3.fromRGB(75, 151, 255);
}

function setCharacter(character: Model): void {
	attributeConnections.forEach((connection) => connection.Disconnect());
	attributeConnections = [];
	activeCharacter = character;
	["FlyChargeActive", "FlyChargeProgress", "FlyDiveActive"].forEach((attributeName) => {
		attributeConnections.push(
			character.GetAttributeChangedSignal(attributeName).Connect(updateChargeDisplay),
		);
	});
	updateChargeDisplay();
}

player.CharacterAdded.Connect(setCharacter);
player.GetAttributeChangedSignal("SelectedCharacter").Connect(updateChargeDisplay);
if (player.Character) {
	setCharacter(player.Character);
}
