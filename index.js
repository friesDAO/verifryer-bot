const fs = require('fs');
const {
    REST
} = require('@discordjs/rest');
const {
    Routes
} = require('discord-api-types/v9');
// Require the necessary discord.js classes
const {
    Client,
    Intents,
    Collection
} = require('discord.js');

const config = require("./config.json")
const faunadb = require("faunadb")
const q = faunadb.query
const { ethers } = require("ethers")
const ERC20ABI = require("./abis/ERC20.json")
const StakingPoolABI = require("./abis/FriesDAOStakingPool.json");
const NFTABI = require("./abis/FriesDAONFT.json")
const BN = n => ethers.BigNumber.from(n)

require('dotenv').config()

function parse(num, decimals = 18) {
    const padded = num.toString().padStart(decimals + 1, "0")
    const parsed = `${padded.slice(0, -decimals)}.${padded.slice(-decimals)}`.replace(/0+$/g, "")
    return parsed.endsWith(".") ? Number(parsed.slice(0, -1)) : Number(parsed)
}


const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MEMBERS] });

const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

const commands = [];

// Creating a collection for commands in client
client.commands = new Collection();


for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    commands.push(command.data.toJSON());
   	client.commands.set(command.data.name, command)
}

// When the client is ready, this only runs once
client.once('ready', async () => {
    console.log('Ready!');
    // Registering the commands in the client
    const CLIENT_ID = client.user.id;
    const rest = new REST({
        version: '10'
    }).setToken(process.env.TOKEN);

	startUpdating()

	try {
		await rest.put(
			Routes.applicationGuildCommands(CLIENT_ID, config.guildId), {
				body: commands
			},
		);
		console.log('Successfully registered application commands for development guild');
	} catch (error) {
		if (error) console.error(error);
	}

	// const permissions = [
	// 	{
	// 		id: client.guilds.cache.get(config.guildId).roles.everyone.id,
	// 		type: "ROLE",
	// 		permission: false
	// 	},
	// 	{
	// 		id: config.adminId,
	// 		type: 'ROLE',
	// 		permission: true,
	// 	}
	// ];

	// const guildCommands = await client.guilds.cache.get(config.guildId)?.commands.fetch();

	// guildCommands.forEach((guildCommand) => {
	// 	// guildCommand.setDefaultPermission(false)
	// 	client.application.commands.permissions.set({ command: guildCommand.id, permissions: permissions })
		
	// })
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try {
        await command.execute(interaction);
    } catch (error) {
        if (error) console.error(error);
        await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
    }
});

const faunaClient = new faunadb.Client({
  secret: process.env.FAUNADB_SECRET,
  domain: 'db.us.fauna.com'
});

const provider = new ethers.providers.JsonRpcProvider(config.provider)
const Token = new ethers.Contract(config.tokenAddress, ERC20ABI, provider)
const StakingPool = new ethers.Contract(config.stakingPoolAddress, StakingPoolABI, provider)
const NFT = new ethers.Contract(config.nftAddress, NFTABI, provider) 

async function updateAllUsers() {
	let query = (await faunaClient.query(
		q.Map(
			q.Paginate(q.Documents(q.Collection("discord-wallet-signatures")), {size: 100000}),
			q.Lambda("X", q.Select(["data"], q.Get(q.Var("X")), ""))
		)
	)).data

	const guild = await client.guilds.fetch(config.guildId)
	const members = await guild.members.fetch()
	const memberIds = Array.from(members.keys())
	const memberRoles = members.reduce((mapping, i) => {
		mapping[i.id] = i.roles.cache.has(config.role)
		return mapping
	}, {})

	const toUpdate = query.filter(s => memberIds.includes(s.id))
	const toRemove = query.filter(s => !toUpdate.includes(s.id))

	if (toRemove.length > 0) {
		await faunaClient.query(
			q.Map(
				q.Paginate(q.Documents(q.Collection("discord-wallet-signatures")), {size: 100000}),
				q.Lambda("X", toRemove.includes(q.Select(["data", "id"], q.Get(q.Var("X")))) ? q.Delete(q.Var("X")) : "")
			)
		)
	}

	if (toUpdate.length > 0) {
		for (const user of toUpdate) {
			updateUser(user, members.get(user.id), memberRoles[user.id])		
		}
	}
}

async function checkVerified(user) {
	const [
		friesBalance,
		friesStaked,
		nftBalance
	] = await Promise.all([
		Token.balanceOf(user.address),
		StakingPool.userInfo(0, user.address),
		NFT.balanceOf(user.address)
	])

	return parse(friesBalance) + parse(friesStaked[0]) >= 5000 || nftBalance > 0
}

async function updateUser(user, member, hasRole) {
	const verified = await checkVerified(user)
	if (verified) {
		if (!hasRole) {
			member.roles.add(config.role)
			// console.log(`added role to ${member.user.username}`)
		}
	} else {
		if (hasRole) {
			member.roles.remove(config.role)
			// console.log(`removed role from ${member.user.username}`)
		}
	}
}

function startUpdating() {
	updateAllUsers()
	setInterval(updateAllUsers, 4 * 60 * 60 * 1000)

	const setRef = q.Documents(q.Collection("discord-wallet-signatures"))

	const streamOptions = { fields: ['action', 'document', "index"] }

	let stream
	const startStream = () => {
	  stream = faunaClient.stream(setRef, streamOptions)
	  .on('set', update => { handleUpdate(update) })
	  .on('error', error => {
		console.log('Error:', error)
		stream.close()
		setTimeout(startStream, 1000)
	  })
	  .start()
	}

	async function handleUpdate(update) {
		console.log(update.action)
		if (update.action === "add") {
			const user = (await faunaClient.query(
				q.Get(update.document.ref)
			)).data

			const guild = await client.guilds.fetch(config.guildId)
			const member = guild.members.cache.get(user.id)
			updateUser(user, member, member.roles.cache.has(config.role))
		}
	}
	
	startStream()
}

client.login(process.env.TOKEN);