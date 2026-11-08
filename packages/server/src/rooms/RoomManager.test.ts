import assert from 'node:assert/strict';
import { RoomManager } from './RoomManager.js';
import { SessionManager } from '../auth/SessionManager.js';
import { AuthenticatedUser, redactStateForPlayer } from '@catan/shared';

const hostUser: AuthenticatedUser = {
  id: 'google_host_1',
  email: 'host@example.com',
  name: 'HostAlice',
};

const player2User: AuthenticatedUser = {
  id: 'google_p2_2',
  email: 'p2@example.com',
  name: 'PlayerBob',
};

const intruderUser: AuthenticatedUser = {
  id: 'google_intruder_3',
  email: 'intruder@example.com',
  name: 'Mallory',
};

function runServerTests() {
  // 1. SessionManager HMAC-SHA256 cookie verification (Item #27)
  const sm = new SessionManager();
  const { signedToken } = sm.createSession(hostUser);
  const verifiedSession = sm.getSessionFromCookieHeader(
    `catan_sid=${encodeURIComponent(signedToken)}`,
  );
  assert.ok(verifiedSession, 'Valid signed session cookie must authenticate');
  assert.equal(verifiedSession.user.id, hostUser.id);
  assert.equal(verifiedSession.user.email, hostUser.email);

  // Forged signature must be rejected
  const forgedCookie = signedToken.slice(0, -4) + 'ffff';
  assert.equal(
    sm.getSessionFromCookieHeader(`catan_sid=${encodeURIComponent(forgedCookie)}`),
    null,
    'Forged session signature must be rejected',
  );

  // 2. Room creation, join, and sanitization (Bug #1 & Bug #2)
  const rm = new RoomManager();
  const { room, player: host } = rm.createRoom(hostUser, hostUser.name, 'red', false, 10);
  const joinRes = rm.joinRoom(room.code, player2User, player2User.name, 'blue');
  assert.equal('room' in joinRes, true);

  // Verify room sanitization strips socketId and gameState
  const sanitizedBeforeStart = rm.sanitizeRoomForClient(room);
  assert.equal('gameState' in (sanitizedBeforeStart as unknown as Record<string, unknown>), false);
  for (const p of Object.values(sanitizedBeforeStart.players)) {
    assert.equal('socketId' in (p as unknown as Record<string, unknown>), false);
    assert.equal('sessionToken' in (p as unknown as Record<string, unknown>), false);
  }
  assert.equal('socketId' in (rm.sanitizePlayerForClient(host) as unknown as Record<string, unknown>), false);

  // 3. Bug #1: Prevent player impersonation on host actions and game actions
  // Unjoined intruder cannot start the game even if claiming hostPlayerId
  const intruderStart = rm.startGame(room.code, intruderUser.id, hostUser.id);
  assert.equal(intruderStart.success, false);

  // Joined non-host player2 cannot start the game or kick host or randomize board
  const nonHostStart = rm.startGame(room.code, player2User.id, hostUser.id);
  assert.equal(nonHostStart.success, false);
  const nonHostKick = rm.kickPlayer(room.code, player2User.id, hostUser.id, hostUser.id);
  assert.equal(nonHostKick.success, false);
  const nonHostRandomize = rm.randomizePreviewBoard(room.code, player2User.id);
  assert.equal(nonHostRandomize.success, false);

  // Host can update custom display name in lobby, randomize board, and start the game
  const renameRes = rm.changePlayerName(room.code, hostUser.id, 'CaptainCatan');
  assert.equal(renameRes.success, true);
  assert.equal(room.players[hostUser.id].name, 'CaptainCatan');

  const hostRandomize = rm.randomizePreviewBoard(room.code, hostUser.id);
  assert.equal(hostRandomize.success, true);
  const hostStart = rm.startGame(room.code, hostUser.id, hostUser.id);
  assert.equal(hostStart.success, true);
  assert.ok(room.gameState);
  assert.equal(room.gameState!.players[hostUser.id].name, 'CaptainCatan');

  // Verify private game data redaction (Bug #2)
  const redactedForHost = redactStateForPlayer(room.gameState!, hostUser.id);
  assert.equal('devCardDeck' in (redactedForHost as unknown as Record<string, unknown>), false);
  assert.equal('balancedDiceDeck' in (redactedForHost as unknown as Record<string, unknown>), false);
  assert.equal('resources' in (redactedForHost.players[player2User.id] as unknown as Record<string, unknown>), false);
  assert.equal('devCards' in (redactedForHost.players[player2User.id] as unknown as Record<string, unknown>), false);

  // Intruder cannot submit actions in the room
  const activeSetupPlayerId = room.gameState!.setupTurnOrder[room.gameState!.setupTurnIndex];
  const inactivePlayerUser = activeSetupPlayerId === hostUser.id ? player2User : hostUser;
  const activePlayerUser = activeSetupPlayerId === hostUser.id ? hostUser : player2User;
  const firstVertexId = Object.keys(room.gameState!.board.vertices)[0];

  const intruderAction = rm.dispatchAction(room.code, intruderUser.id, {
    type: 'BUILD_SETUP_SETTLEMENT',
    playerId: activeSetupPlayerId,
    vertexId: firstVertexId,
  });
  assert.equal(intruderAction.success, false);

  // Inactive player trying to impersonate activeSetupPlayerId is rejected!
  const impersonatedAction = rm.dispatchAction(room.code, inactivePlayerUser.id, {
    type: 'BUILD_SETUP_SETTLEMENT',
    playerId: activeSetupPlayerId,
    vertexId: firstVertexId,
  });
  assert.equal(impersonatedAction.success, false);
  assert.match(impersonatedAction.error || '', /Unauthorized/i);

  // Active player performing their own move succeeds
  const validAction = rm.dispatchAction(room.code, activePlayerUser.id, {
    type: 'BUILD_SETUP_SETTLEMENT',
    playerId: activePlayerUser.id,
    vertexId: firstVertexId,
  });
  assert.equal(validAction.success, true);

  // 4. Bug #10: Deadline synchronization when an action arrives after turnDeadlineMs
  room.gameState!.turnDeadlineMs = Date.now() - 1000;
  const expiredAction = rm.dispatchAction(room.code, activePlayerUser.id, {
    type: 'BUILD_SETUP_ROAD',
    playerId: activePlayerUser.id,
    edgeId: 'nonexistent_edge',
  });
  assert.equal(expiredAction.success, false);
  assert.equal(
    expiredAction.stateChanged,
    true,
    'Expired deadline must flag stateChanged=true so server persists and broadcasts timeout transition',
  );

  // 5. Improvement #26: Room-scoped chat validation & rate limiting
  const intruderChat = rm.sendChatMessage(room.code, intruderUser.id, 'Hello');
  assert.equal(intruderChat.success, false, 'Non-member cannot chat in room');

  // Test rate-limiting (5 messages per 5s window; space timestamps outside 250ms min interval)
  const rateKey = `${room.code}:${hostUser.id}`;
  const now = Date.now();
  (rm as unknown as { chatTimestamps: Map<string, number[]> }).chatTimestamps.set(rateKey, [
    now - 4000,
    now - 3200,
    now - 2400,
    now - 1600,
  ]);
  const fifthMsg = rm.sendChatMessage(room.code, hostUser.id, '5th message in window');
  assert.equal(fifthMsg.success, true);
  assert.equal(fifthMsg.message?.playerName, 'CaptainCatan');

  // Simulate 300ms later (still within 5s window of all 5 messages)
  (rm as unknown as { chatTimestamps: Map<string, number[]> }).chatTimestamps.set(rateKey, [
    now - 4000,
    now - 3200,
    now - 2400,
    now - 1600,
    now - 400,
  ]);
  const sixthMsg = rm.sendChatMessage(room.code, hostUser.id, '6th message in window');
  assert.equal(sixthMsg.success, false, '6th message within 5s window must be rate-limited');

  // 6. Host Delete Lobby & Re-create with same account
  const nonHostDelete = rm.deleteRoom(room.code, player2User.id);
  assert.equal(nonHostDelete.success, false, 'Non-host cannot delete lobby');

  const hostDelete = rm.deleteRoom(room.code, hostUser.id);
  assert.equal(hostDelete.success, true, 'Host can delete their lobby');
  assert.equal(rm.getRoom(room.code), undefined, 'Deleted lobby is removed from RoomManager');

  const { room: newRoom } = rm.createRoom(hostUser, 'CaptainCatan2', 'orange', false, 10);
  assert.ok(newRoom.code, 'Host can immediately create a new lobby with the same account');
  rm.deleteRoom(newRoom.code, hostUser.id);

  console.log('✓ All server security, redaction, deadline sync, lobby delete, and chat tests passed!');
}

runServerTests();
