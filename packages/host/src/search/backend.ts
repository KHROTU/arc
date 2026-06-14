export interface EmbeddingVector {
  values: number[];
  dim: number;
}
export interface EmbeddingRequest {
  model: string;
  input: string | string[];
}
export interface EmbeddingBackend {
  readonly id: string;
  readonly model: string;
  readonly dim: number;
  embed(req: EmbeddingRequest): Promise<EmbeddingVector[]>;
}