--[[
	DonationServer  (taruh di ServerScriptService, tipe: Script)

	Alur: server game ini -> poll API -> filter teks -> kirim notifikasi ke semua pemain.
	Roblox tidak bisa menerima request masuk, jadi game yang menarik (poll) data dari server webhook.

	PENTING:
	- Script ini harus tetap di ServerScriptService. Jangan taruh API_KEY di LocalScript / ReplicatedStorage.
	- Aktifkan Game Settings > Security > "Allow HTTP Requests".
]]

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TextService = game:GetService("TextService")
local GroupService = game:GetService("GroupService")

local CONFIG = {
	BASE_URL = "https://GANTI-DENGAN-DOMAIN-SERVER-KAMU", -- tanpa "/" di akhir
	API_KEY = "GANTI_DENGAN_ROBLOX_API_KEY", -- sama dengan ROBLOX_API_KEY di server
	POLL_INTERVAL = 5, -- detik
	MAX_BACKOFF = 60, -- detik, batas jeda saat server error
	MIN_AMOUNT = 0, -- abaikan donasi di bawah nominal ini
	FILTER_USER_ID = nil, -- opsional: UserId pemilik game untuk TextFilter (otomatis jika kosong)
}

local remote = Instance.new("RemoteEvent")
remote.Name = "DonationAlert"
remote.Parent = ReplicatedStorage

--------------------------------------------------------------------------------
-- Text filtering (WAJIB: nama & pesan donatur adalah teks buatan pengguna)
--------------------------------------------------------------------------------

local cachedFilterUserId: number? = nil

local function getFilterUserId(): number?
	if CONFIG.FILTER_USER_ID then
		return CONFIG.FILTER_USER_ID
	end
	if cachedFilterUserId then
		return cachedFilterUserId
	end

	if game.CreatorType == Enum.CreatorType.User and game.CreatorId > 0 then
		cachedFilterUserId = game.CreatorId
	elseif game.CreatorType == Enum.CreatorType.Group and game.CreatorId > 0 then
		local ok, info = pcall(GroupService.GetGroupInfoAsync, GroupService, game.CreatorId)
		if ok and info and info.Owner then
			cachedFilterUserId = info.Owner.Id
		end
	end

	-- Fallback untuk Studio / game yang belum dipublish: pakai pemain mana saja.
	if not cachedFilterUserId then
		local anyPlayer = Players:GetPlayers()[1]
		if anyPlayer then
			return anyPlayer.UserId
		end
	end
	return cachedFilterUserId
end

-- Mengembalikan fungsi (player) -> teks yang sudah difilter untuk pemain itu.
local function makeFilter(text: string)
	if text == "" then
		return function()
			return ""
		end
	end

	local userId = getFilterUserId()
	if not userId then
		return nil
	end

	local ok, result = pcall(function()
		return TextService:FilterStringAsync(text, userId, Enum.TextFilterContext.PublicChat)
	end)
	if not ok then
		warn("[Donation] FilterStringAsync gagal:", result)
		return nil
	end

	return function(player: Player)
		local ok2, filtered = pcall(function()
			return result:GetChatForUserAsync(player.UserId)
		end)
		return if ok2 then filtered else ""
	end
end

local function broadcast(donation)
	local nameFilter = makeFilter(donation.name)
	local messageFilter = makeFilter(donation.message)

	for _, player in Players:GetPlayers() do
		task.spawn(function()
			local name = if nameFilter then nameFilter(player) else "Seorang donatur"
			local message = if messageFilter then messageFilter(player) else ""
			remote:FireClient(player, {
				name = name,
				amount = donation.amount,
				message = message,
			})
		end)
	end
end

--------------------------------------------------------------------------------
-- Polling
--------------------------------------------------------------------------------

local cursor: number? = nil

local function request(path: string)
	local ok, res = pcall(HttpService.RequestAsync, HttpService, {
		Url = CONFIG.BASE_URL .. path,
		Method = "GET",
		Headers = { ["x-api-key"] = CONFIG.API_KEY },
	})
	if not ok then
		warn("[Donation] request gagal:", res)
		return nil
	end
	if not res.Success then
		warn("[Donation] HTTP", res.StatusCode, res.StatusMessage)
		return nil
	end

	local decoded, data = pcall(HttpService.JSONDecode, HttpService, res.Body)
	if not decoded then
		warn("[Donation] JSON tidak valid")
		return nil
	end
	return data
end

local function pollOnce(): boolean
	local path = "/api/donations"
	if cursor then
		path ..= "?after=" .. tostring(cursor)
	end

	local data = request(path)
	if not data then
		return false
	end

	-- Pertama kali: hanya ambil kursor, jangan memutar ulang riwayat lama.
	if cursor == nil or data.reset then
		cursor = data.latest
		return true
	end

	for _, donation in data.donations do
		cursor = donation.id
		if donation.amount >= CONFIG.MIN_AMOUNT then
			broadcast(donation)
		end
	end
	return true
end

task.spawn(function()
	local delay = CONFIG.POLL_INTERVAL
	while true do
		local ok = pollOnce()
		if ok then
			delay = CONFIG.POLL_INTERVAL
		else
			delay = math.min(delay * 2, CONFIG.MAX_BACKOFF)
		end
		task.wait(delay)
	end
end)
