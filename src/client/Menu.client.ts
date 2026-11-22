const player = game.GetService("Players").LocalPlayer;
const playerGui = player.WaitForChild("PlayerGui") as PlayerGui;
const selectionEvent = game.GetService("ReplicatedStorage").WaitForChild("SelectCharacter") as RemoteEvent;

const existingMenu = playerGui.FindFirstChild("StormMenu");
if (existingMenu) {
	existingMenu.Destroy();
}

const screenGui = new Instance("ScreenGui");
screenGui.Name = "StormMenu";
screenGui.ResetOnSpawn = false;
screenGui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling;
screenGui.Parent = playerGui;

const menu = new Instance("Frame");
menu.Name = "Menu";
menu.AnchorPoint = new Vector2(0.5, 0.5);
menu.Position = UDim2.fromScale(0.5, 0.5);
menu.Size = UDim2.fromOffset(480, 330);
menu.BackgroundColor3 = Color3.fromRGB(30, 36, 48);
menu.BorderSizePixel = 0;
menu.Parent = screenGui;

const menuCorner = new Instance("UICorner");
menuCorner.CornerRadius = new UDim(0, 12);
menuCorner.Parent = menu;

const title = new Instance("TextLabel");
title.Name = "Title";
title.Position = UDim2.fromOffset(0, 24);
title.Size = new UDim2(1, 0, 0, 40);
title.BackgroundTransparency = 1;
title.Font = Enum.Font.GothamBold;
title.Text = "STORM";
title.TextColor3 = Color3.fromRGB(255, 255, 255);
title.TextSize = 30;
title.Parent = menu;

const subtitle = new Instance("TextLabel");
subtitle.Position = UDim2.fromOffset(0, 68);
subtitle.Size = new UDim2(1, 0, 0, 24);
subtitle.BackgroundTransparency = 1;
subtitle.Font = Enum.Font.Gotham;
subtitle.Text = "Choose your character";
subtitle.TextColor3 = Color3.fromRGB(185, 194, 210);
subtitle.TextSize = 16;
subtitle.Parent = menu;

const characters = ["Rage", "Flood", "Rain"];
const characterButtons: TextButton[] = [];
let selectedCharacter = characters[0];

characters.forEach((character, index) => {
	const characterButton = new Instance("TextButton");
	characterButton.Name = `${character}Button`;
	characterButton.Position = UDim2.fromOffset(24 + index * 144, 128);
	characterButton.Size = UDim2.fromOffset(136, 80);
	characterButton.BackgroundColor3 = Color3.fromRGB(49, 60, 78);
	characterButton.BorderSizePixel = 0;
	characterButton.Font = Enum.Font.GothamBold;
	characterButton.Text = character;
	characterButton.TextColor3 = Color3.fromRGB(255, 255, 255);
	characterButton.TextSize = 18;
	characterButton.Parent = menu;

	const characterCorner = new Instance("UICorner");
	characterCorner.CornerRadius = new UDim(0, 8);
	characterCorner.Parent = characterButton;

	characterButtons.push(characterButton);
});

const selectionLabel = new Instance("TextLabel");
selectionLabel.Name = "SelectionLabel";
selectionLabel.Position = UDim2.fromOffset(0, 222);
selectionLabel.Size = new UDim2(1, 0, 0, 24);
selectionLabel.BackgroundTransparency = 1;
selectionLabel.Font = Enum.Font.Gotham;
selectionLabel.TextColor3 = Color3.fromRGB(185, 194, 210);
selectionLabel.TextSize = 14;
selectionLabel.Parent = menu;

const updateSelection = () => {
	selectionLabel.Text = `Selected: ${selectedCharacter}`;
	characterButtons.forEach((characterButton, index) => {
		characterButton.BackgroundColor3 =
			characters[index] === selectedCharacter
				? Color3.fromRGB(76, 139, 245)
				: Color3.fromRGB(49, 60, 78);
	});
};

characters.forEach((character, index) => {
	characterButtons[index].Activated.Connect(() => {
		selectedCharacter = character;
		updateSelection();
		selectionEvent.FireServer(character);
	});
});
updateSelection();

const playButton = new Instance("TextButton");
playButton.Name = "PlayButton";
playButton.AnchorPoint = new Vector2(0.5, 0);
playButton.Position = new UDim2(0.5, 0, 0, 266);
playButton.Size = UDim2.fromOffset(220, 48);
playButton.BackgroundColor3 = Color3.fromRGB(76, 139, 245);
playButton.BorderSizePixel = 0;
playButton.Font = Enum.Font.GothamBold;
playButton.Text = "PLAY";
playButton.TextColor3 = Color3.fromRGB(255, 255, 255);
playButton.TextSize = 18;
playButton.Parent = menu;

const buttonCorner = new Instance("UICorner");
buttonCorner.CornerRadius = new UDim(0, 8);
buttonCorner.Parent = playButton;

const openButton = new Instance("TextButton");
openButton.Name = "OpenMenuButton";
openButton.Position = UDim2.fromOffset(20, 20);
openButton.Size = UDim2.fromOffset(120, 44);
openButton.BackgroundColor3 = Color3.fromRGB(30, 36, 48);
openButton.BorderSizePixel = 0;
openButton.Font = Enum.Font.GothamBold;
openButton.Text = "MENU";
openButton.TextColor3 = Color3.fromRGB(255, 255, 255);
openButton.TextSize = 16;
openButton.Visible = false;
openButton.Parent = screenGui;

const openButtonCorner = new Instance("UICorner");
openButtonCorner.CornerRadius = new UDim(0, 8);
openButtonCorner.Parent = openButton;

playButton.Activated.Connect(() => {
	selectionEvent.FireServer(selectedCharacter);
	player.CameraMode = Enum.CameraMode.Classic;
	player.CameraMinZoomDistance = 12;
	player.CameraMaxZoomDistance = 12;
	menu.Visible = false;
	openButton.Visible = true;
});

openButton.Activated.Connect(() => {
	menu.Visible = true;
	openButton.Visible = false;
});
