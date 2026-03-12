export interface SheetsClient {
  read(range: string): Promise<string[][]>;
  update(range: string, values: string[][]): Promise<void>;
  append(range: string, values: string[][]): Promise<void>;
}

