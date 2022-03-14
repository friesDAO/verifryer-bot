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

require('dotenv').config()

const client = new Client({ intents: [Intents.FLAGS.GUILDS] });

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
        version: '9'
    }).setToken(process.env.TOKEN);
	try {
		if (!process.env.GUILD) {
			await rest.put(
				Routes.applicationCommands(CLIENT_ID), {
					body: commands
				},
			);
			console.log('Successfully registered application commands globally');
		} else {
			await rest.put(
				Routes.applicationGuildCommands(CLIENT_ID, process.env.GUILD), {
					body: commands
				},
			);
			console.log('Successfully registered application commands for development guild');
		}
	} catch (error) {
		if (error) console.error(error);
	}

	const permissions = [
		{
			id: process.env.ADMINID,
			type: 'ROLE',
			permission: true,
		}
	];

	const guildCommands = await client.guilds.cache.get(process.env.GUILD)?.commands.fetch();

	guildCommands.forEach((guildCommand) => {
		guildCommand.setDefaultPermission(false)
		guildCommand.permissions.add({ permissions })
	})

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

client.login(process.env.TOKEN);