// CMS related TypeScript type definitions

export type ContentStatus = 'draft' | 'published' | 'archived';
export type ContentType = 'page' | 'blog' | 'template';

export interface Page {
  id: string;
  businessId: string;
  userId: string;
  title: string;
  slug: string;
  description?: string;
  content?: any; // JSON content structure
  r2Key?: string;
  template?: string;
  status: ContentStatus;
  type: ContentType;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  ogImage?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  businessId: string;
  name: string;
  slug: string;
  description?: string;
  type: string;
  color?: string;
  parentId?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: string;
  businessId: string;
  name: string;
  slug: string;
  color?: string;
  createdAt: string;
}

export interface MediaFile {
  id: string;
  businessId: string;
  userId: string;
  fileName: string;
  originalName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  width?: number;
  height?: number;
  alt?: string;
  description?: string;
  tags?: string[];
  folderId?: string;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Template {
  id: string;
  businessId?: string; // null = system template
  name: string;
  description?: string;
  type: string;
  category?: string;
  preview?: string;
  config: any; // JSON configuration
  content?: any; // JSON content
  isPublic: boolean;
  usageCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// API response types
export interface PageListResponse {
  pages: Page[];
  total: number;
  pagination: {
    limit: number;
    offset: number;
  };
}

export interface PageResponse {
  success: boolean;
  page: Page;
}

export interface PageCreateRequest {
  title: string;
  description?: string;
  content?: any;
  template?: string;
  status?: ContentStatus;
  type?: ContentType;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  ogImage?: string;
}

export interface PageUpdateRequest extends Partial<PageCreateRequest> {
  // All fields are optional
}

// Content editor related types
export interface ContentBlock {
  id: string;
  type: string;
  data: any;
}

export interface ContentStructure {
  blocks: ContentBlock[];
  version: string;
  time: number;
}

// Template related types
export interface TemplateConfig {
  name: string;
  description?: string;
  category: string;
  fields: TemplateField[];
}

export interface TemplateField {
  name: string;
  type: 'text' | 'textarea' | 'image' | 'select' | 'boolean';
  label: string;
  required?: boolean;
  placeholder?: string;
  options?: string[]; // for select type
}