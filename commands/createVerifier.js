const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageActionRow, MessageButton } = require('discord.js');
const aes256 = require("aes256")

module.exports = {
    data: new SlashCommandBuilder()
        .setName('createverifier')
        .setDescription('Creates a verifier button in a specified channel')
		.addChannelOption(channel => {
			return channel
				.setName("channel")
				.setDescription("The channel to create the verifier button in")
				.setRequired(true)
		}),
    async execute(interaction) {
		const channel = interaction.options.getChannel("channel")
		const row = new MessageActionRow()
			.addComponents(
				new MessageButton()
					.setCustomId('generate')
					.setLabel("Let's Go!")
					.setStyle('PRIMARY'),
			);

		channel.send({
			embeds: [{
				author: {
					iconURL: "https://fries.fund/friesdao-square.png",
					name: "The Verifryer"
				},
				title: "Verifry your FRIES!",
				description: "Click the button below to verify your FRIES holdings!",
				thumbnail: {
					url: "https://fries.fund/friesdao-square.png",
				}
			}],
			components: [row]
		})

		const filter = i => i.customId === 'generate';

		const collector = channel.createMessageComponentCollector({ filter })

		collector.on("collect", async i => {
			const replyRow = new MessageActionRow()
			.addComponents(
				new MessageButton()
					.setLabel("Connect wallet")
					.setStyle('LINK')
					.setURL(`https://verifry.fries.fund/?id=${aes256.encrypt(process.env.KEY, i.user.id)}`),
			);

			i.reply({content: "Click below to connect your wallet (do not share this link)", ephemeral: true, components: [replyRow] })
		})

        interaction.reply({ content: `Created verifier button in channel: ${channel}`, ephemeral: true })
    }
};