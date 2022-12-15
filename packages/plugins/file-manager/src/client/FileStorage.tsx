import React from 'react';
import { SchemaComponent } from '@nocobase/client';
import { Card } from 'antd';
import { storageSchema } from './schemas/storage';
import { StorageOptions } from './StorageOptions';

export const FileStoragePane = () => {
  return (
    <Card bordered={false}>
      <SchemaComponent components={{ StorageOptions }} schema={storageSchema} />
    </Card>
  );
};
