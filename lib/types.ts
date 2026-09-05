export type ProjectStatus = 'active' | 'inactive' | 'archived';

export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: ProjectStatus;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
}

export type InstanceStatus = 'disconnected' | 'connecting' | 'qr_pending' | 'connected' | 'error';
export type ConnectionType = 'qr' | 'pairing_code';

export interface WhatsappInstance {
  id: string;
  project_id: string;
  name: string;
  phone_number: string | null;
  connection_type: ConnectionType;
  pairing_code: string | null;
  qr_code: string | null;
  status: InstanceStatus;
  error_message: string | null;
  last_connected_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  project_id: string;
  whatsapp_instance_id: string | null;
  wa_id: string;
  name: string | null;
  phone_number: string | null;
  avatar_url: string | null;
  tags: string[];
  notes: string | null;
  blocked: boolean;
  created_at: string;
  updated_at: string;
}

export type Channel = 'wa' | 'ig' | 'fb';

export interface Conversation {
  id: string;
  project_id: string;
  whatsapp_instance_id: string;
  contact_id: string;
  channel: Channel;
  last_message_preview: string | null;
  last_message_at: string | null;
  unread_count: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
  contact?: Contact;
  instance?: Pick<WhatsappInstance, 'id' | 'name' | 'status'>;
}

export type MessageDirection = 'inbound' | 'outbound';
export type MessageType = 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'other';
export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface Message {
  id: string;
  project_id: string;
  conversation_id: string;
  whatsapp_instance_id: string;
  wa_message_id: string | null;
  direction: MessageDirection;
  sender_name: string | null;
  content: string | null;
  message_type: MessageType;
  media_url: string | null;
  status: MessageStatus;
  created_at: string;
}

export interface QuickReply {
  id: string;
  project_id: string;
  shortcut: string;
  content: string;
  created_at: string;
  updated_at: string;
}
