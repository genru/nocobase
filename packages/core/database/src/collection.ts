import merge from 'deepmerge';
import { EventEmitter } from 'events';
import { default as lodash, default as _ } from 'lodash';
import {
  ModelOptions,
  ModelStatic,
  QueryInterfaceDropTableOptions,
  SyncOptions,
  Transactionable,
  Utils,
  CreateOptions,
  UpdateOptions,
  FindOptions,
} from 'sequelize';
import { Database } from './database';
import { Field, FieldOptions } from './fields';
import { Model } from './model';
import { Repository } from './repository';
import { checkIdentifier, md5 } from './utils';

export type RepositoryType = typeof Repository;

export type CollectionSortable = string | boolean | { name?: string; scopeKey?: string };

export interface CollectionOptions extends Omit<ModelOptions, 'name' | 'hooks'> {
  name: string;
  tableName?: string;
  inherits?: string[] | string;
  filterTargetKey?: string;
  fields?: FieldOptions[];
  model?: string | ModelStatic<Model>;
  repository?: string | RepositoryType;
  sortable?: CollectionSortable;
  /**
   * @default true
   */
  autoGenId?: boolean;
  /**
   * @default 'options'
   */
  magicAttribute?: string;
  [key: string]: any;
}

export interface CollectionContext {
  database: Database;
}

export class Collection<
  TModelAttributes extends {} = any,
  TCreationAttributes extends {} = TModelAttributes,
> extends EventEmitter {
  options: CollectionOptions;
  context: CollectionContext;
  isThrough?: boolean;
  fields: Map<string, any> = new Map<string, any>();
  model: ModelStatic<Model>;
  repository: Repository<TModelAttributes, TCreationAttributes>;

  get filterTargetKey() {
    return lodash.get(this.options, 'filterTargetKey', this.model.primaryKeyAttribute);
  }

  get name() {
    return this.options.name;
  }

  get titleField() {
    return (this.options.titleField as string) || this.model.primaryKeyAttribute;
  }

  get db() {
    return this.context.database;
  }

  constructor(options: CollectionOptions, context: CollectionContext) {
    super();
    this.checkOptions(options);

    this.context = context;
    this.options = options;

    this.bindFieldEventListener();
    this.modelInit();

    if(options['tree']) {
        
      options.fields.push({type: 'integer', name: 'hierarchyLevel'})
      options.fields.push({type: 'string', name: 'path'})
      options.fields.push({'type': 'hasMany', 'name': 'children', 'foreignKey':'parentId','target': options.name})
      options.fields.push({'type': 'belongsTo', 'name': 'parent', 'foreignKey':'parentId','target': options.name});

      const buildOptions = (options, opt) => {
        if(opt.transaction) options.transaction = opt.transaction;
        if(opt.logging) options.logging = opt.logging;
        return options;
      };

      this.db.on(`${this.name}.beforeCreate`, async (item: Model, opt: CreateOptions) => {
        console.info(`${this.name}.beforeCreate`, '>>>');
        const levelFieldName = 'hierarchyLevel';
        const parentId = item['parentId'];
        if (!parentId) {
          item[levelFieldName] = 1;
          return;
        }

        const itemId = item.id;
        if(parentId===itemId) {
          throw new Error('ParentId should not equal self id');
        }

        const parent = await this.repository.findOne(buildOptions({
          where: {'id': parentId}, 
          attributes: [levelFieldName], 
          hooks: false
        }, opt));
        if(!parent) {
          // throw new Error('Parent does not exist');
          console.warn(`${itemId} ${item.parentId} not created`);
        }

        item[levelFieldName] = parent[levelFieldName]+1;
        opt.fields = Array.from(new Set(opt.fields.concat([levelFieldName])));
        console.info(`${this.name}.beforeCreate`, '<<<');
      });

      this.db.on(`${this.name}.afterCreate`, async (item, opt: CreateOptions) => {
        try {
          console.info(`${this.name}.afterCreate`, '>>>')
          const parentId = item.parentId;
          const itemId = item.id;
          if(!parentId) {
            await this.repository.update(buildOptions({
              hooks: false, 
              values:{'path': `${itemId}`},
              filterByTk: itemId
            }, opt));
            return;
          }  
          const parent = await this.repository.findOne(buildOptions({filterByTk: parentId, hooks: false}, opt));
          if(!parent) {
            throw new Error('Parent does not exist');
          }

          const parentPath = parent.path;

          await this.repository.update(buildOptions({
            hooks: false, 
            values:{'path': `${parentPath}.${itemId}`},
            filterByTk: itemId
          }, opt));

          // return item;
        } catch(err) {
          console.warn(err);
        } finally {
          console.info(`${this.name}.afterCreate`, '<<<');
        }
      })

      // update hook
      this.db.on(`${this.name}.beforeUpdate`, async (item: Model, options: UpdateOptions) => {
        console.info(`${this.name}.beforeUpdate`, '>>>', item.id);
        const levelFieldName = 'hierarchyLevel';

        const itemId = item.id;
        const parentId = item.parentId;
        const path = item.path;
        let oldParentId = item._previousDataValues['parentId'];
        let oldLevel = item._previousDataValues[levelFieldName];
        let oldPath = item._previousDataValues['path'];
        // console.info('id=%d, parentId=%d, path=%s, oldParentId=%s, oldLevel=%d, oldPath=%s', itemId, parentId, path, oldParentId, oldLevel, oldPath);

        if(oldParentId !== undefined && parentId === oldParentId) {
          console.info('parentId did not update');
          return;
        }

        if (oldParentId === undefined || oldLevel === undefined) {
          const itemRecord = await this.repository.findOne(buildOptions({filterByTk: itemId, hooks: false}, options));
          oldParentId = itemRecord['parentId'];
          oldLevel = itemRecord[levelFieldName];
        }

        // If parent not changing, exit - no change to make
        if (parentId === oldParentId) return;

        // update level since parent changed
        let level = 1;
        if(parentId !== undefined) {
          if(parentId===itemId) {
            throw new Error('parentId should not equal to self id');
          }
          const parent = await this.repository.findOne(buildOptions({
            filterByTk: parentId,
            // where: {id: parentId}, 
            attributes: [levelFieldName, 'parentId', 'path'],
            hooks: false
          }, options));
          if(!parent) {
            throw new Error('Parent does not exist');
          }
          level = parent[levelFieldName] + 1;
          if(level !== oldLevel) {
            item[levelFieldName] = level;
          }

          // update path
          const path = `${parent.path}.${itemId}`
          item['path'] = path;

          // try to find all descendents
          const children = await this.repository.find(buildOptions({filter: {path: {$startsWith: `${oldPath}.`}}, hooks: false}, options))     // regex would be a perfect way

          // update descendents' path
          // TODO: try bulk-save method for efficiency
          await Promise.all(children.map(i => {
            i.path = i.path.replace(`${oldPath}.`, `${path}.`);
            i[levelFieldName] = i.path.split('.').length;
            return i.save(buildOptions({},options));
          }))

        } else {    // here parent removed
          
          item[levelFieldName] = level;
          const path = `${itemId}`
          item['path'] = path;

          // try to find all descendents
          const children = await this.repository.find(buildOptions({filter: {path: {$startsWith: `${oldPath}.`}}, hooks: false}, options))     // regex would be a perfect way

          // update descendents' path
          // TODO: try bulk-save method for efficiency
          await Promise.all(children.map(i => {
            i.path = i.path.replace(`${oldPath}.`, `${path}.`);
            i[levelFieldName] = i.path.split('.').length;
            return i.save(buildOptions({},options));
          }))        
        }

        console.info(`${this.name}.beforeUpdate`, '<<<');
      })

      // after define
      // this.db.on(`afterDefineCollection`, async (model: Collection) => {
      //   console.info(`${model.name}.afterDefineCollection`, '>>>');

      //   // let {hierarchy} = model.options;
      //   // console.info(model.options);
      //   console.info(`${model.name}.afterDefineCollection`, '<<<');
      // })

      // this.model.beforeFindAfterExpandIncludeAll(async (options) => {
      //   console.info(`${this.name}.beforeFindAfterExpandIncludeAll`, '>>>')
      //   console.info(`${this.name}.beforeFindAfterExpandIncludeAll`, '<<<')
      // })

      // // b4 find
      // this.model.beforeFind((options: FindOptions) => {
      //   console.info('b4 Find', '>>>');
      //   console.info('b4 Find', '<<<');
      // })

      // this.model.beforeFindAfterOptions((options)=> {
      //   console.info('beforeFindAfterOptions', '>>>', options)
      //   console.info('beforeFindAfterOptions', '<<<')
      // })

      // after find
      this.model.afterFind(async (result, options: FindOptions) => {
        if (!options['tree']) return;
        
        result = Array.isArray(result)? result: [result];
        console.info(`${this.name}.afterFind >>>`)
        try {
          // If no hierarchies to expand anywhere in tree of includes, return
          const buildChildren = (item: Model, allItems) => {
            if(item.dataValues['children']) return;
            item.dataValues['children'] = allItems.filter(i => i.parentId===item.id);
            if(item.dataValues['children']?.length) {
              item.dataValues['children'].forEach(i => buildChildren(i, allItems))
            }
          }
          result.forEach((i, index, arr) => {
            buildChildren(i, arr);
          });
        } catch (err) {
          console.error(err);
        } finally {
          console.info(`${this.name}.afterFind <<<`)
        }
      })
    }

    this.db.modelCollection.set(this.model, this);
    this.db.tableNameCollectionMap.set(this.model.tableName, this);

    if (!options.inherits) {
      this.setFields(options.fields);
    }

    this.setRepository(options.repository);
    this.setSortable(options.sortable);
  }

  private checkOptions(options: CollectionOptions) {
    checkIdentifier(options.name);
  }

  private sequelizeModelOptions() {
    const { name, tableName } = this.options;
    return {
      ..._.omit(this.options, ['name', 'fields', 'model', 'targetKey']),
      modelName: name,
      sequelize: this.context.database.sequelize,
      tableName: tableName || name,
    };
  }

  /**
   * TODO
   */
  modelInit() {
    if (this.model) {
      return;
    }
    const { name, model, autoGenId = true } = this.options;
    let M: ModelStatic<Model> = Model;
    if (this.context.database.sequelize.isDefined(name)) {
      const m = this.context.database.sequelize.model(name);
      if ((m as any).isThrough) {
        // @ts-ignore
        this.model = m;
        // @ts-ignore
        this.model.database = this.context.database;
        // @ts-ignore
        this.model.collection = this;
        return;
      }
    }
    if (typeof model === 'string') {
      M = this.context.database.models.get(model) || Model;
    } else if (model) {
      M = model;
    }
    // @ts-ignore
    this.model = class extends M {};
    this.model.init(null, this.sequelizeModelOptions());

    if (!autoGenId) {
      this.model.removeAttribute('id');
    }

    // @ts-ignore
    this.model.database = this.context.database;
    // @ts-ignore
    this.model.collection = this;
  }

  setRepository(repository?: RepositoryType | string) {
    let repo = Repository;
    if (typeof repository === 'string') {
      repo = this.context.database.repositories.get(repository) || Repository;
    }
    this.repository = new repo(this);
  }

  private bindFieldEventListener() {
    this.on('field.afterAdd', (field: Field) => {
      field.bind();
    });

    this.on('field.afterRemove', (field: Field) => {
      field.unbind();
    });
  }

  forEachField(callback: (field: Field) => void) {
    return [...this.fields.values()].forEach(callback);
  }

  findField(callback: (field: Field) => boolean) {
    return [...this.fields.values()].find(callback);
  }

  hasField(name: string) {
    return this.fields.has(name);
  }

  getField<F extends Field>(name: string): F {
    return this.fields.get(name);
  }

  addField(name: string, options: FieldOptions): Field {
    return this.setField(name, options);
  }

  setField(name: string, options: FieldOptions): Field {
    checkIdentifier(name);

    const { database } = this.context;

    const field = database.buildField(
      { name, ...options },
      {
        ...this.context,
        collection: this,
      },
    );

    const oldField = this.fields.get(name);

    if (oldField && oldField.options.inherit && field.typeToString() != oldField.typeToString()) {
      throw new Error(
        `Field type conflict: cannot set "${name}" on "${this.name}" to ${options.type}, parent "${name}" type is ${oldField.options.type}`,
      );
    }

    if (this.options.autoGenId !== false && options.primaryKey) {
      this.model.removeAttribute('id');
    }

    this.removeField(name);
    this.fields.set(name, field);
    this.emit('field.afterAdd', field);

    // refresh children models
    if (this.isParent()) {
      for (const child of this.context.database.inheritanceMap.getChildren(this.name, {
        deep: false,
      })) {
        const childCollection = this.db.getCollection(child);
        const existField = childCollection.getField(name);

        if (!existField || existField.options.inherit) {
          childCollection.setField(name, {
            ...options,
            inherit: true,
          });
        }
      }
    }

    return field;
  }

  setFields(fields: FieldOptions[], resetFields = true) {
    if (!Array.isArray(fields)) {
      return;
    }

    if (resetFields) {
      this.resetFields();
    }

    for (const { name, ...options } of fields) {
      this.addField(name, options);
    }
  }

  resetFields() {
    const fieldNames = this.fields.keys();
    for (const fieldName of fieldNames) {
      this.removeField(fieldName);
    }
  }

  remove() {
    this.context.database.removeCollection(this.name);
  }

  async removeFromDb(options?: QueryInterfaceDropTableOptions) {
    if (
      await this.existsInDb({
        transaction: options?.transaction,
      })
    ) {
      const queryInterface = this.db.sequelize.getQueryInterface();
      await queryInterface.dropTable(this.model.tableName, options);
    }
    this.remove();
  }

  async existsInDb(options?: Transactionable) {
    return this.db.collectionExistsInDb(this.name, options);
  }

  removeField(name: string): void | Field {
    if (!this.fields.has(name)) {
      return;
    }

    const field = this.fields.get(name);

    const bool = this.fields.delete(name);

    if (bool) {
      if (this.isParent()) {
        for (const child of this.db.inheritanceMap.getChildren(this.name, {
          deep: false,
        })) {
          const childCollection = this.db.getCollection(child);
          const existField = childCollection.getField(name);
          if (existField && existField.options.inherit) {
            childCollection.removeField(name);
          }
        }
      }

      this.emit('field.afterRemove', field);
    }

    return field as Field;
  }

  /**
   * TODO
   */
  updateOptions(options: CollectionOptions, mergeOptions?: any) {
    let newOptions = lodash.cloneDeep(options);
    newOptions = merge(this.options, newOptions, mergeOptions);

    this.context.database.emit('beforeUpdateCollection', this, newOptions);

    this.setFields(options.fields, false);
    this.setRepository(options.repository);

    this.context.database.emit('afterUpdateCollection', this);

    return this;
  }

  setSortable(sortable) {
    if (!sortable) {
      return;
    }
    if (sortable === true) {
      this.setField('sort', {
        type: 'sort',
        hidden: true,
      });
    }
    if (typeof sortable === 'string') {
      this.setField(sortable, {
        type: 'sort',
        hidden: true,
      });
    } else if (typeof sortable === 'object') {
      const { name, ...opts } = sortable;
      this.setField(name || 'sort', { type: 'sort', hidden: true, ...opts });
    }
  }

  /**
   * TODO
   *
   * @param name
   * @param options
   */
  updateField(name: string, options: FieldOptions) {
    if (!this.hasField(name)) {
      throw new Error(`field ${name} not exists`);
    }

    if (options.name && options.name !== name) {
      this.removeField(name);
    }

    this.setField(options.name || name, options);
  }

  addIndex(index: string | string[] | { fields: string[]; unique?: boolean; [key: string]: any }) {
    if (!index) {
      return;
    }
    let indexes: any = this.model.options.indexes || [];
    let indexName = [];
    let indexItem;
    if (typeof index === 'string') {
      indexItem = {
        fields: [index],
      };
      indexName = [index];
    } else if (Array.isArray(index)) {
      indexItem = {
        fields: index,
      };
      indexName = index;
    } else if (index?.fields) {
      indexItem = index;
      indexName = index.fields;
    }
    if (lodash.isEqual(this.model.primaryKeyAttributes, indexName)) {
      return;
    }
    const name: string = this.model.primaryKeyAttributes.join(',');
    if (name.startsWith(`${indexName.join(',')},`)) {
      return;
    }
    for (const item of indexes) {
      if (lodash.isEqual(item.fields, indexName)) {
        return;
      }
      const name: string = item.fields.join(',');
      if (name.startsWith(`${indexName.join(',')},`)) {
        return;
      }
    }
    if (!indexItem) {
      return;
    }
    indexes.push(indexItem);
    this.model.options.indexes = indexes;
    const tableName = this.model.getTableName();
    // @ts-ignore
    this.model._indexes = this.model.options.indexes
      // @ts-ignore
      .map((index) => Utils.nameIndex(this.model._conformIndex(index), tableName))
      .map((item) => {
        if (item.name && item.name.length > 63) {
          item.name = 'i_' + md5(item.name);
        }
        return item;
      });
    this.refreshIndexes();
  }

  removeIndex(fields: any) {
    if (!fields) {
      return;
    }
    // @ts-ignore
    const indexes: any[] = this.model._indexes;
    // @ts-ignore
    this.model._indexes = indexes.filter((item) => {
      return !lodash.isEqual(item.fields, fields);
    });
    this.refreshIndexes();
  }

  refreshIndexes() {
    // @ts-ignore
    const indexes: any[] = this.model._indexes;
    // @ts-ignore
    this.model._indexes = indexes.filter((item) => {
      for (const field of item.fields) {
        if (!this.model.rawAttributes[field]) {
          return false;
        }
      }
      return true;
    });
  }

  async sync(syncOptions?: SyncOptions) {
    const modelNames = new Set([this.model.name]);

    const { associations } = this.model;

    for (const associationKey in associations) {
      const association = associations[associationKey];
      modelNames.add(association.target.name);

      if ((<any>association).through) {
        modelNames.add((<any>association).through.model.name);
      }
    }

    const models: ModelStatic<Model>[] = [];
    // @ts-ignore
    this.context.database.sequelize.modelManager.forEachModel((model) => {
      if (modelNames.has(model.name)) {
        models.push(model);
      }
    });

    for (const model of models) {
      await model.sync(syncOptions);
    }
  }

  public isInherited() {
    return false;
  }

  public isParent() {
    return this.context.database.inheritanceMap.isParentNode(this.name);
  }
}
