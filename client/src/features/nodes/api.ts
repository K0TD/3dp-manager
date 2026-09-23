import api from '../../api';
import type { NodePayload, NodeRecord, RoutingPresetSelection, RoutingPresetView } from '../../types/node';

interface NodeCheckResult {
  success: boolean;
  version?: string;
  xrayVersion?: string;
  capabilities?: NodeRecord['capabilities'];
  message?: string;
}

export const nodesApi = {
  async routingPresets(id: string) {
    const { data } = await api.get<RoutingPresetView>(`/nodes/${id}/routing-presets`);
    return data;
  },

  async updateRoutingPresets(id: string, payload: RoutingPresetSelection) {
    const { data } = await api.put<RoutingPresetView>(`/nodes/${id}/routing-presets`, payload);
    return data;
  },

  async list() {
    const { data } = await api.get<NodeRecord[]>('/nodes');
    return data;
  },

  async create(payload: NodePayload) {
    const { data } = await api.post<NodeRecord>('/nodes', payload);
    return data;
  },

  async update(id: string, payload: Partial<NodePayload>) {
    const { data } = await api.put<NodeRecord>(`/nodes/${id}`, payload);
    return data;
  },

  async remove(id: string, mode: 'safe' | 'deferred' | 'force' = 'safe') {
    const { data } = await api.delete<{
      success: boolean;
      deferred?: boolean;
      forced?: boolean;
    }>(`/nodes/${id}`, { params: { mode } });
    return data;
  },

  async setMain(id: string) {
    const { data } = await api.post<NodeRecord>(`/nodes/${id}/main`);
    return data;
  },

  async check(id: string) {
    const { data } = await api.post<NodeCheckResult>(
      `/nodes/${id}/check`,
    );
    return data;
  },

  async checkPayload(payload: NodePayload) {
    const { data } = await api.post<NodeCheckResult>(
      '/nodes/check',
      payload,
    );
    return data;
  },

  async detectLocation(url: string) {
    const { data } = await api.post<{
      ip?: string;
      host?: string;
      domain?: string;
      flag?: string;
      country?: string;
      countryCode?: string;
    }>('/nodes/detect-location', { url });
    return data;
  },

  async syncFromMain() {
    const { data } = await api.post<{ success: boolean; count: number }>(
      '/nodes/sync/main',
    );
    return data;
  },
};
