import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RoutingPresetsDialog } from '../../src/features/nodes/RoutingPresetsDialog';
import { nodesApi } from '../../src/features/nodes/api';
import type { NodeRecord, RoutingPresetView } from '../../src/types/node';

vi.mock('../../src/features/nodes/api', () => ({ nodesApi: { routingPresets: vi.fn(), updateRoutingPresets: vi.fn() } }));
const node = { id: 'node-42', name: 'Berlin' } as NodeRecord;
const initial: RoutingPresetView = { available: true, blockRussia: false, blockIpCheckers: false, revision: 'revision-1', needsApply: false, warnings: [] };

describe('node routing quick settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(nodesApi.routingPresets).mockResolvedValue(initial);
  });

  it('loads the selected node and keeps changes local until Apply', async () => {
    render(<RoutingPresetsDialog node={node} onClose={vi.fn()} />);
    const russia = await screen.findByRole('switch', { name: 'Блокировать российские домены и IP' });
    expect(nodesApi.routingPresets).toHaveBeenCalledWith('node-42');
    expect(screen.getByRole('button', { name: 'Применить' })).toBeDisabled();
    fireEvent.click(russia);
    expect(nodesApi.updateRoutingPresets).not.toHaveBeenCalled();
    expect(screen.getByRole('switch', { name: 'Блокировать сервисы определения IP' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Применить' })).toBeEnabled();
  });

  it('submits both switches with a revision and confirms verified success', async () => {
    vi.mocked(nodesApi.updateRoutingPresets).mockResolvedValue({ ...initial, blockIpCheckers: true, revision: 'revision-2', result: 'applied', message: 'Настройки применены, Xray работает.' });
    render(<RoutingPresetsDialog node={node} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Блокировать сервисы определения IP' }));
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
    expect(await screen.findByText('Настройки применены, Xray работает.')).toBeInTheDocument();
    expect(nodesApi.updateRoutingPresets).toHaveBeenCalledWith('node-42', { blockRussia: false, blockIpCheckers: true, revision: 'revision-1' });
    expect(screen.getByRole('button', { name: 'Применить' })).toBeDisabled();
  });

  it('disables controls for an unsupported panel and shows its reason', async () => {
    vi.mocked(nodesApi.routingPresets).mockResolvedValue({ ...initial, available: false, revision: '', warnings: ['API маршрутизации недоступен'] });
    render(<RoutingPresetsDialog node={node} onClose={vi.fn()} />);
    expect(await screen.findByText('API маршрутизации недоступен')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Блокировать российские домены и IP' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Применить' })).toBeDisabled();
  });

  it('requires reloading after conflict and permits retry with the new revision', async () => {
    vi.mocked(nodesApi.updateRoutingPresets).mockRejectedValue({ response: { data: { message: 'Конфигурация изменилась' } } });
    render(<RoutingPresetsDialog node={node} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Блокировать российские домены и IP' }));
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
    expect(await screen.findByText('Конфигурация изменилась')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Применить' })).toBeDisabled();
    vi.mocked(nodesApi.routingPresets).mockResolvedValue({ ...initial, revision: 'revision-3' });
    fireEvent.click(screen.getByRole('button', { name: 'Обновить состояние' }));
    await waitFor(() => expect(nodesApi.routingPresets).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByRole('switch', { name: 'Блокировать российские домены и IP' }));
    expect(screen.getByRole('button', { name: 'Применить' })).toBeEnabled();
  });

  it('shows rollback failure as an error, and never labels it a success', async () => {
    vi.mocked(nodesApi.updateRoutingPresets).mockResolvedValue({ ...initial, revision: '', result: 'rollback_failed', message: 'Автоматический откат не завершён.' });
    render(<RoutingPresetsDialog node={node} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Блокировать российские домены и IP' }));
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
    expect(await screen.findByText('Автоматический откат не завершён.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Применить' })).toBeDisabled();
  });

  it('prevents duplicate submission and closing while the operation is pending', async () => {
    let finish!: (response: RoutingPresetView) => void;
    vi.mocked(nodesApi.updateRoutingPresets).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const close = vi.fn();
    render(<RoutingPresetsDialog node={node} onClose={close} />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Блокировать российские домены и IP' }));
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
    expect(screen.getByRole('button', { name: 'Применение…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(close).not.toHaveBeenCalled();
    finish({ ...initial, result: 'applied', message: 'Готово' });
    await screen.findByText('Готово');
  });
});
