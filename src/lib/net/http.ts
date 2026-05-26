import axios from "axios";
import { configureNodeOutboundProxy } from "./proxy";

export async function getJson<T>(url: string): Promise<T> {
  configureNodeOutboundProxy();
  const response = await axios.get<T>(url);
  return response.data;
}
