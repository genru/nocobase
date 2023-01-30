import { Plugin } from '@nocobase/server';
import _ from 'lodash';
import path from 'path';

export class PresetNocoBase extends Plugin {
  getBuiltInPlugins() {
    const plugins = (process.env.PRESET_NOCOBASE_PLUGINS || '').split(',').filter(Boolean);
    return _.uniq(
      [
        'error-handler',
        'collection-manager',
        'ui-schema-storage',
        'ui-routes-storage',
        'file-manager',
        'system-settings',
        'sequence-field',
        'verification',
        'users',
        'acl',
        'china-region',
        'workflow',
        'client',
        'export',
        'import',
        'audit-logs',
        'duplicator',
        'iframe-block',
        'math-formula-field',
        'excel-formula-field',
      ].concat(plugins),
    );
  }

  getLocalPlugins() {
    const localPlugins = ['sample-hello', 'oidc', 'saml', 'map', 'snapshot-field', 'graph-collection-manager'];
    return localPlugins;
  }

  async addBuiltInPlugins(options?: any) {
    const builtInPlugins = this.getBuiltInPlugins();
    await this.app.pm.add(builtInPlugins, {
      enabled: true,
      builtIn: true,
      installed: true,
    });
    const localPlugins = this.getLocalPlugins();
    await this.app.pm.add(localPlugins, {});
    await this.app.reload({ method: options.method });
  }

  afterAdd() {
    this.app.on('beforeLoad', async (app, options) => {
      if (options?.method !== 'upgrade') {
        return;
      }
      const version = await this.app.version.get();
      console.log(`The version number before upgrade is ${version}`);
      // const result = await this.app.version.satisfies('<0.8.0-alpha.1');
      // if (result) {
      //   const r = await this.db.collectionExistsInDb('applicationPlugins');
      //   if (r) {
      //     console.log(`Clear the installed application plugins`);
      //     await this.db.getRepository('applicationPlugins').destroy({ truncate: true });
      //     await this.app.reload({ method: options.method });
      //   }
      // }
    });
    this.app.on('beforeUpgrade', async (options) => {
      const result = await this.app.version.satisfies('<0.8.0-alpha.1');
      if (result) {
        console.log(`Initialize all built-in plugins`);
        await this.addBuiltInPlugins({ method: 'upgrade' });
      }
      const builtInPlugins = this.getBuiltInPlugins();
      const plugins = await this.app.db.getRepository('applicationPlugins').find();
      const pluginNames = plugins.map((p) => p.name);
      await this.app.pm.add(
        builtInPlugins.filter((plugin) => !pluginNames.includes(plugin)),
        {
          enabled: true,
          builtIn: true,
          installed: true,
        },
      );
      const localPlugins = this.getLocalPlugins();
      await this.app.pm.add(
        localPlugins.filter((plugin) => !pluginNames.includes(plugin)),
        {},
      );
      await this.app.reload({ method: 'upgrade' });
      await this.app.db.sync();
    });
    this.app.on('beforeInstall', async (options) => {
      console.log(`Initialize all built-in plugins`);
      await this.addBuiltInPlugins({ method: 'install' });
    });
  }

  beforeLoad() {
    this.db.addMigrations({
      namespace: this.getName(),
      directory: path.resolve(__dirname, './migrations'),
      context: {
        plugin: this,
      },
    });
  }
}

export default PresetNocoBase;
