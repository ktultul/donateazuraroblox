--[[
	DonationClient  (taruh di StarterPlayer > StarterPlayerScripts, tipe: LocalScript)
	Menampilkan notifikasi donasi yang dikirim oleh DonationServer.
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")

local remote = ReplicatedStorage:WaitForChild("DonationAlert")
local playerGui = Players.LocalPlayer:WaitForChild("PlayerGui")

local DISPLAY_TIME = 6 -- detik per notifikasi
local GOLD = Color3.fromRGB(255, 205, 60)

--------------------------------------------------------------------------------
-- UI
--------------------------------------------------------------------------------

local gui = Instance.new("ScreenGui")
gui.Name = "DonationAlertGui"
gui.ResetOnSpawn = false
gui.IgnoreGuiInset = false
gui.Parent = playerGui

local card = Instance.new("Frame")
card.Size = UDim2.fromOffset(380, 0)
card.AutomaticSize = Enum.AutomaticSize.Y
card.AnchorPoint = Vector2.new(0.5, 0)
card.Position = UDim2.new(0.5, 0, 0, -200) -- di luar layar
card.BackgroundColor3 = Color3.fromRGB(28, 30, 38)
card.BorderSizePixel = 0
card.Parent = gui

Instance.new("UICorner", card).CornerRadius = UDim.new(0, 12)

local stroke = Instance.new("UIStroke")
stroke.Color = GOLD
stroke.Thickness = 2
stroke.Parent = card

local padding = Instance.new("UIPadding")
padding.PaddingTop = UDim.new(0, 12)
padding.PaddingBottom = UDim.new(0, 12)
padding.PaddingLeft = UDim.new(0, 16)
padding.PaddingRight = UDim.new(0, 16)
padding.Parent = card

local layout = Instance.new("UIListLayout")
layout.Padding = UDim.new(0, 4)
layout.SortOrder = Enum.SortOrder.LayoutOrder
layout.Parent = card

local function makeLabel(order: number, size: number, font: Enum.Font, color: Color3)
	local label = Instance.new("TextLabel")
	label.LayoutOrder = order
	label.BackgroundTransparency = 1
	label.Size = UDim2.new(1, 0, 0, 0)
	label.AutomaticSize = Enum.AutomaticSize.Y
	label.TextWrapped = true
	label.TextXAlignment = Enum.TextXAlignment.Left
	label.TextSize = size
	label.Font = font
	label.TextColor3 = color
	label.Text = ""
	label.Parent = card
	return label
end

local titleLabel = makeLabel(1, 14, Enum.Font.GothamBold, GOLD)
local nameLabel = makeLabel(2, 18, Enum.Font.GothamBold, Color3.new(1, 1, 1))
local messageLabel = makeLabel(3, 14, Enum.Font.Gotham, Color3.fromRGB(200, 210, 225))

titleLabel.Text = "DONASI MASUK"

--------------------------------------------------------------------------------
-- Util
--------------------------------------------------------------------------------

local function formatRupiah(n: number): string
	local reversed = string.reverse(tostring(math.floor(n)))
	reversed = reversed:gsub("(%d%d%d)", "%1.")
	local out = string.reverse(reversed)
	if string.sub(out, 1, 1) == "." then
		out = string.sub(out, 2)
	end
	return "Rp " .. out
end

--------------------------------------------------------------------------------
-- Antrean notifikasi (satu per satu, tidak saling menimpa)
--------------------------------------------------------------------------------

local queue = {}
local showing = false

local function show(donation)
	nameLabel.Text = `{donation.name} • {formatRupiah(donation.amount)}`
	messageLabel.Text = donation.message
	messageLabel.Visible = donation.message ~= ""

	local info = TweenInfo.new(0.35, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)
	TweenService:Create(card, info, { Position = UDim2.new(0.5, 0, 0, 16) }):Play()
	task.wait(DISPLAY_TIME)

	local out = TweenInfo.new(0.3, Enum.EasingStyle.Quad, Enum.EasingDirection.In)
	TweenService:Create(card, out, { Position = UDim2.new(0.5, 0, 0, -200) }):Play()
	task.wait(0.4)
end

local function processQueue()
	if showing then
		return
	end
	showing = true
	while #queue > 0 do
		show(table.remove(queue, 1))
	end
	showing = false
end

remote.OnClientEvent:Connect(function(donation)
	if type(donation) ~= "table" then
		return
	end
	table.insert(queue, {
		name = tostring(donation.name or ""),
		amount = tonumber(donation.amount) or 0,
		message = tostring(donation.message or ""),
	})
	task.spawn(processQueue)
end)
