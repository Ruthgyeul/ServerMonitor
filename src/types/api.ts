import { ServerData } from '@/types/system';

export interface SystemDataResponse {
  serverData: ServerData;
  networkHistory: unknown[];
}

export interface ApiError {
  message: string;
  code: string;
}
