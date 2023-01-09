import { useForm } from '@formily/react';
import { cloneDeep } from 'lodash';
import { EditOutlined } from '@ant-design/icons';
import React, { useState, useContext, useEffect } from 'react';
import { useAPIClient } from '../../api-client';
import { ActionContext, SchemaComponent, useActionContext } from '../../schema-component';
import { useCancelAction } from '../action-hooks';
import { RecordProvider, useRecord } from '../../record-provider';
import * as components from './components';
import { useRequest } from '../../api-client';
import { collectionCategoryEditSchema } from './schemas/collections';
import { CollectionCategroriesContext } from '../context';

const useEditCategry = () => {
  const form = useForm();
  const ctx = useActionContext();
  const CategroriesCtx = useContext(CollectionCategroriesContext);
  const api = useAPIClient();
  const { id } = useRecord();
  return {
    async run() {
      await form.submit();
      const values = cloneDeep(form.values);
      await api.resource('collection_categories').update({
        filter: { id: id },
        values: {
          ...values,
        },
      });
      ctx.setVisible(false);
      await form.reset();
      await CategroriesCtx.refresh();
    },
  };
};

const useValuesFromRecord = (options) => {
  const record = useRecord();
  const result = useRequest(() => Promise.resolve({ data: { ...record } }), {
    ...options,
    manual: true,
  });
  const ctx = useActionContext();
  useEffect(() => {
    if (ctx.visible) {
      result.run();
    }
  }, [ctx.visible]);
  return result;
};

export const EditCategory = (props) => {
  return <EditCategoryAction {...props} />;
};

export const EditCategoryAction = (props) => {
  const { scope, getContainer, item, children } = props;
  const [visible, setVisible] = useState(false);
  return (
    <RecordProvider record={item}>
      <ActionContext.Provider value={{ visible, setVisible }}>
        <>{children || <EditOutlined onClick={() => setVisible(true)} />}</>
        <SchemaComponent
          schema={collectionCategoryEditSchema}
          components={{ ...components }}
          scope={{
            getContainer,
            useCancelAction,
            createOnly: true,
            useEditCategry,
            useValuesFromRecord,
            ...scope,
          }}
        />
      </ActionContext.Provider>
    </RecordProvider>
  );
};
