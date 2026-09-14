import { expect, it } from 'vitest';
import { createGame } from '../src/game/Game';

it('transitions from menu to countdown to racing', () => {
  const game = createGame(null as never);
  expect(game.phase).toBe('menu');
  game.startQuickRace('city', 'starter');
  game.tick(4000);
  expect(game.phase).toBe('racing');
  game.pause();
  expect(game.phase).toBe('paused');
  game.dispose();
});
