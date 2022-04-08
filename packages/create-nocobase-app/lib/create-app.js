const chalk = require('chalk');
const fse = require('fs-extra');
const path = require('path');
const { hasYarn, runInit, runInstall } = require('./utils');
const ora = require('ora');
const execa = require('execa');
const { join } = require('path');

const createEnvFile = require('./resources/templates/env');
const createPackageJson = require('./resources/templates/package.json.js');
const createServerPackageJson = require('./resources/templates/server.package.json.js');

const getDatabaseOptionsFromCommandOptions = (commandOptions) => {
  if (
    commandOptions.quickstart ||
    !commandOptions.dbdialect ||
    commandOptions.dbdialect === 'sqlite' ||
    commandOptions.dbstorage
  ) {
    return {
      dialect: 'sqlite',
      storage: commandOptions.dbstorage || 'db.sqlite',
    };
  }

  return {
    dialect: commandOptions.dbdialect,
    host: commandOptions.dbhost,
    port: commandOptions.dbport,
    database: commandOptions.dbdatabase,
    username: commandOptions.dbusername,
    password: commandOptions.dbpassword,
  };
};

async function createApp(directory, options) {
  console.log(`Creating a new NocoBase application at ${chalk.green(directory)}.`);
  console.log('Creating files.');

  const projectPath = path.join(process.cwd(), directory);
  const resourcePath = path.join(__dirname, 'resources');

  const dbOptions = getDatabaseOptionsFromCommandOptions(options);

  // copy files
  await fse.copy(path.join(resourcePath, 'files'), projectPath);

  // write .env file
  await fse.writeFile(join(projectPath, '.env'), createEnvFile({ dbOptions }));

  // write packages.json
  await fse.writeJson(
    join(projectPath, 'package.json'),
    createPackageJson({
      projectName: 'nocobase-app',
    }),
    {
      space: 2,
    },
  );

  await fse.writeJson(
    join(projectPath, 'packages/server/package.json'),
    createServerPackageJson({
      version: '^0.6.0-alpha.0',
      dbOptions,
    }),
    {
      space: 2,
    },
  );
}

function setCommandOptions(command) {
  return command
    .arguments('<directory>', 'directory of new NocoBase app')
    .option('--quickstart', 'Quickstart app creation')
    .option('--dbdialect <dbdialect>', 'Database dialect, current support sqlite/mysql/postgres')
    .option('--dbhost <dbhost>', 'Database host')
    .option('--dbport <dbport>', 'Database port')
    .option('--dbdatabase <dbdatabase>', 'Database name')
    .option('--dbusername <dbusername>', 'Database username')
    .option('--dbpassword <dbpassword>', 'Database password')
    .option('--dbstorage <dbstorage>', 'Database file storage path for sqlite')
    .description('create a new application');
}

module.exports = {
  setCommandOptions,
  createApp,
};
