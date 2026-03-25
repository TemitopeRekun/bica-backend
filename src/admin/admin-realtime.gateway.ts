import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/admin',
})
export class AdminRealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private adminSockets = new Map<string, string>();

  handleConnection(client: Socket) {
    console.log(`Admin client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    for (const [adminId, socketId] of this.adminSockets.entries()) {
      if (socketId === client.id) {
        this.adminSockets.delete(adminId);
        console.log(`Admin ${adminId} disconnected socket ${client.id}`);
        break;
      }
    }
  }

  @SubscribeMessage('admin:register')
  handleAdminRegister(
    @MessageBody() data: { adminId: string },
    @ConnectedSocket() client: Socket,
  ) {
    this.adminSockets.set(data.adminId, client.id);
    client.join('admins');
    console.log(`Admin ${data.adminId} registered socket ${client.id}`);
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
