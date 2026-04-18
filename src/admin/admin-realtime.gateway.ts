import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: { 
    origin: (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:3001,http://localhost:5173,http://localhost:5174').split(',').map(o => o.trim()),
    credentials: true
  },
  namespace: '/admin',
})
export class AdminRealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(AdminRealtimeGateway.name);

  constructor(private jwtService: JwtService) {}

  @WebSocketServer()
  server: Server;

  private adminSockets = new Map<string, string>();

  private verifySocketToken(client: Socket): { sub: string; role: string } | null {
    const token = client.handshake.auth?.token as string | undefined;
    if (!token) return null;
    try {
      return this.jwtService.verify<{ sub: string; role: string }>(token, {
        secret: process.env.JWT_SECRET,
      });
    } catch {
      return null;
    }
  }

  handleConnection(client: Socket) {
    this.logger.debug(`Admin client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    for (const [adminId, socketId] of this.adminSockets.entries()) {
      if (socketId === client.id) {
        this.adminSockets.delete(adminId);
        this.logger.debug(`Admin ${adminId} disconnected socket ${client.id}`);
        break;
      }
    }
  }

  @SubscribeMessage('admin:register')
  handleAdminRegister(
    @MessageBody() data: { adminId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const payload = this.verifySocketToken(client);
    if (payload !== null) {
      if (payload.role !== 'ADMIN') {
        this.logger.warn(`[WS] admin:register rejected — role is ${payload.role}, not ADMIN`);
        client.emit('error', { message: 'Unauthorized: admin role required' });
        return;
      }
      if (payload.sub !== data.adminId) {
        this.logger.warn(`[WS] admin:register rejected — token sub ${payload.sub} !== claimed ${data.adminId}`);
        client.emit('error', { message: 'Unauthorized: adminId mismatch' });
        return;
      }
    }
    this.adminSockets.set(data.adminId, client.id);
    client.join('admins');
    this.logger.debug(`Admin ${data.adminId} registered socket ${client.id}`);
  }

  notifyUserUpdated(action: string, user: Record<string, unknown>) {
    this.emitAdminEvent('admin:user:updated', { action, user });
  }

  notifyTripUpdated(action: string, trip: Record<string, unknown>) {
    this.emitAdminEvent('admin:trip:updated', { action, trip });
  }

  notifyPayoutUpdated(action: string, payout: Record<string, unknown>) {
    this.emitAdminEvent('admin:payout:updated', { action, payout });
  }

  notifySettingsUpdated(settings: Record<string, unknown>) {
    this.emitAdminEvent('admin:settings:updated', { settings });
  }

  notifyPaymentUpdated(action: string, payment: Record<string, unknown>) {
    this.emitAdminEvent('admin:payment:updated', { action, payment });
  }

  notifyPendingDriver(user: Record<string, unknown>) {
    this.emitAdminEvent('admin:driver:pending_approval', { user });
  }

  private emitAdminEvent(event: string, payload: Record<string, unknown>) {
    const data = {
      ...payload,
      timestamp: new Date().toISOString(),
    };

    this.server.to('admins').emit(event, data);
    this.server.to('admins').emit('admin:dashboard:update', {
      event,
      ...data,
    });
  }
}
