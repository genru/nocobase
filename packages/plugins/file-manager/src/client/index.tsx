import { PluginManagerContext, SettingsCenterProvider, registerField, CollectionManagerContext } from '@nocobase/client';
import React, { useContext } from 'react';
import { FileStoragePane } from './FileStorage';
import { FileStorageShortcut } from './FileStorageShortcut';
import { attachment } from './interfaces/attachment';
import { NAMESPACE } from './locale';

registerField(attachment.group, 'attachment', attachment);

export default function (props) {
  const ctx = useContext(PluginManagerContext);
  return (
    <SettingsCenterProvider
      settings={{
        'file-manager': {
          title: `{{t("File manager", { ns: "${NAMESPACE}" })}}`,
          icon: 'FileOutlined',
          tabs: {
            storages: {
              title: `{{t("Storages", { ns: "${NAMESPACE}" })}}`,
              component: FileStoragePane,
            },
          },
        },
      }}
    >
      <PluginManagerContext.Provider
        value={{
          components: {
            ...ctx?.components,
            FileStorageShortcut,
          },
        }}
      >
        <CollectionManagerContext.Provider value={{ ...ctx, interfaces: { ...ctx.interfaces, attachment } }}>
          {props.children}
        </CollectionManagerContext.Provider>
      </PluginManagerContext.Provider>
    </SettingsCenterProvider>
  );
}
