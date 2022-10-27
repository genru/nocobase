const { Command } = require('commander');
const commands = require('./commands');

const cli = new Command();

cli.version(require('../package.json').version);

process.env.NODE_OPTIONS = '--openssl-legacy-provider --no-experimental-fetch';

commands(cli);

module.exports = cli;
