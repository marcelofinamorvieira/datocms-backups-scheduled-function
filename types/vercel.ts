export type VercelRequest = {
  method?: string;
  body: any;
  headers?: Record<string, unknown>;
  query?: Record<string, unknown>;
  url?: string;
  internalBackupsSharedSecret?: string;
  internalDatocmsApiToken?: string;
  [key: string]: any;
};

export type VercelResponse = {
  setHeader: (name: string, value: string) => void;
  status: (statusCode: number) => VercelResponse;
  json: (jsonBody: any) => VercelResponse;
  end: () => void;
  [key: string]: any;
};
