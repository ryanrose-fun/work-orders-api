import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const order = {id: 'order-1', title: 'Inspect sensor', status: 'queued', version: 1};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json'}});
async function connect() {
  const user = userEvent.setup();
  render(<App />);
  await user.type(screen.getByLabelText('API token'), 'test-only-token');
  await user.click(screen.getByText('Open console →'));
  await screen.findByText('Order register');
  return user;
}
test('validates blank titles and creates an order without persisting credentials', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(json([])).mockResolvedValueOnce(json(order, 201));
  vi.stubGlobal('fetch', fetcher);
  const user = await connect();
  await user.type(screen.getByLabelText('Order title'), '   ');
  await user.click(screen.getByText('+ Create order'));
  expect(screen.getByRole('alert').textContent).toContain('between 1 and 200');
  expect(fetcher).toHaveBeenCalledTimes(1);
  await user.clear(screen.getByLabelText('Order title'));
  await user.type(screen.getByLabelText('Order title'), 'Inspect sensor');
  await user.click(screen.getByText('+ Create order'));
  await screen.findByText('Just created');
  expect(fetcher.mock.calls[1][1].body).toBe(JSON.stringify({title: 'Inspect sensor'}));
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});
test('409 requires reload and sends the new version only after another explicit save', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(json([order]))
    .mockResolvedValueOnce(json({detail: 'Stale version; reload the order'}, 409))
    .mockResolvedValueOnce(json({...order, status: 'active', version: 2}))
    .mockResolvedValueOnce(json({...order, status: 'cancelled', version: 3}));
  vi.stubGlobal('fetch', fetcher);
  const user = await connect();
  await user.selectOptions(screen.getByLabelText('Next status for Inspect sensor'), 'cancelled');
  await user.click(screen.getByRole('button', {name: 'Save'}));
  await screen.findByText('Reload latest version');
  expect((screen.getByRole('button', {name: 'Save'}) as HTMLButtonElement).disabled).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(2);
  await user.click(screen.getByText('Reload latest version'));
  await screen.findByText(/Loaded version 2/);
  expect(fetcher).toHaveBeenCalledTimes(3);
  await user.click(screen.getByRole('button', {name: 'Save'}));
  await screen.findByText('Status saved.');
  expect(JSON.parse(fetcher.mock.calls[3][1].body)).toEqual({status: 'cancelled', expected_version: 2});
  expect(screen.getByText('Closed · no further transitions')).toBeTruthy();
});
test('uncertain create failure retains input and never blindly retries', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(json([])).mockRejectedValueOnce(new TypeError('Failed to fetch'));
  vi.stubGlobal('fetch', fetcher);
  const user = await connect();
  await user.type(screen.getByLabelText('Order title'), 'Keep my input');
  await user.click(screen.getByText('+ Create order'));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toContain('may have been created');
  expect((screen.getByLabelText('Order title') as HTMLInputElement).value).toBe('Keep my input');
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
});
test('rejected credentials keep the console locked', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({detail: 'Invalid bearer token'}, 401)));
  render(<App />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('API token'), 'wrong');
  await user.click(screen.getByText('Open console →'));
  await screen.findByRole('alert');
  expect(screen.queryByText('Order register')).toBeNull();
});
