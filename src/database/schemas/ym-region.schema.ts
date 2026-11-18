import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type YmRegionDocument = YmRegion & Document;

/**
 * Регион справочника Маркета, поднятый до субъекта РФ, — кэш для разреза «Топа товаров»
 * по регионам («Топ товаров», src/modules/yandex/README.md).
 *
 * Зачем кэш. Архив заказов отдаёт регион доставки как `{id, name}` без родителей: это
 * бывает и город, и село, и сам субъект. Подъём до субъекта — `GET regions/{id}`, у
 * которого суточное ограничение по числу регионов, а справочник почти не меняется.
 * Поэтому каждый id спрашивается у Маркета один раз на всех продавцов. TTL нет намеренно.
 */
@Schema({ timestamps: true, versionKey: false })
export class YmRegion {
  @Prop({ type: Number, required: true })
  regionId: number;

  @Prop({ type: String, required: true })
  name: string;

  /** Субъект РФ (`REPUBLIC` в цепочке родителей); `null` — в цепочке его нет. */
  @Prop({ type: String, default: null })
  subject: string | null;

  /** Федеральный округ (`COUNTRY_DISTRICT`); `null` — в цепочке его нет. */
  @Prop({ type: String, default: null })
  district: string | null;
}

export const YmRegionSchema = SchemaFactory.createForClass(YmRegion);

YmRegionSchema.index({ regionId: 1 }, { unique: true });
