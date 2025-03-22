// Firebase module declarations
declare module 'firebase/app' {
  export function initializeApp(config: any): any;
}

declare module 'firebase/database' {
  export function getDatabase(app?: any): any;
  export function ref(database: any, path: string): any;
  export function set(ref: any, data: any): Promise<void>;
  export function push(ref: any): any;
  export function update(ref: any, data: any): Promise<void>;
  export function onValue(ref: any, callback: (snapshot: any) => void, errorCallback?: (error: Error) => void): void;
  
  export interface DataSnapshot {
    val(): any;
    exists(): boolean;
  }
  
  export type DatabaseReference = any;
}

// Types for Figma Plugin API
declare const figma: PluginAPI;
declare const __html__: string;

interface PluginAPI {
  readonly apiVersion: "1.0.0";
  readonly command: string;
  readonly editorType: "figma" | "figjam" | "slides";
  readonly pluginId?: string;
  readonly widgetId?: string;
  readonly fileKey: string | undefined;
  skipInvisibleInstanceChildren: boolean;
  readonly currentUser: User | null;
  readonly users: readonly User[];

  readonly ui: UIAPI;
  readonly viewport: ViewportAPI;
  readonly root: DocumentNode;
  readonly mixed: symbol;

  notify(message: string, options?: NotificationOptions): NotificationHandler;
  closePlugin(message?: string): void;

  on(type: "selectionchange" | "currentpagechange" | "close" | "documentchange", callback: () => void): void;
  off(type: "selectionchange" | "currentpagechange" | "close" | "documentchange", callback: () => void): void;

  createRectangle(): RectangleNode;
  createLine(): LineNode;
  createEllipse(): EllipseNode;
  createPolygon(): PolygonNode;
  createStar(): StarNode;
  createVector(): VectorNode;
  createText(): TextNode;
  createFrame(): FrameNode;
  createComponent(): ComponentNode;
  createPage(): PageNode;
  createSlice(): SliceNode;
  createSticky(): StickyNode;
  createConnector(): ConnectorNode;
  createShapeWithText(): ShapeWithTextNode;
  createCodeBlock(): CodeBlockNode;

  createNodeFromSvg(svg: string): FrameNode;
  createImage(data: Uint8Array): Image;
  createImageAsync(data: Uint8Array): Promise<Image>;

  group(nodes: (SceneNode | ComponentSetNode)[], parent: PageNode | FrameNode | GroupNode | ComponentNode | ComponentSetNode, index?: number): GroupNode;
  ungroup(node: SceneNode & ChildrenMixin): void;

  combineAsVariants(nodes: (ComponentNode | ComponentSetNode)[], parent: PageNode | FrameNode | GroupNode | ComponentNode | ComponentSetNode, index?: number): ComponentSetNode;

  flatten(nodes: (SceneNode | ComponentSetNode)[], parent?: BaseNode | null, index?: number): VectorNode;
}

interface UIAPI {
  show(): void;
  hide(): void;
  resize(width: number, height: number): void;
  close(): void;

  postMessage(pluginMessage: any): void;
  onmessage(callback: (pluginMessage: any) => void): void;

  createPanelSection(options: { title: string }): PanelSection
}

interface User {
  readonly id: string;
  readonly name: string;
  readonly photoUrl: string | null;
}

interface ViewportAPI {
  center: { x: number; y: number };
  zoom: number;
  scrollAndZoomIntoView(nodes: ReadonlyArray<BaseNode>): void;
  bounds: Rect;
}

interface NotificationOptions {
  timeout?: number;
  error?: boolean;
  onDequeue?: (reason: NotificationReason) => void;
  button?: {
    text: string;
    action: () => boolean | void;
  }
}

interface NotificationHandler {
  cancel: () => void;
}

type NotificationReason = "expired" | "dismissed" | "completed";

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface PanelSection {
  readonly widget: PanelSectionWidget;
}

interface PanelSectionWidget {
  appendChild(child: HTMLElement): void;
}

// Minimal Node types
interface DocumentNode {
  readonly children: ReadonlyArray<PageNode>;
  readonly type: "DOCUMENT";
  readonly id: string;
  appendChild(child: PageNode): void;
  insertChild(index: number, child: PageNode): void;
  findAll(callback?: (node: PageNode) => boolean): Array<PageNode>;
  findOne(callback: (node: PageNode) => boolean): PageNode | null;
  parent: null;
  getPluginData(key: string): string;
  setPluginData(key: string, value: string): void;
  getSharedPluginData(namespace: string, key: string): string;
  setSharedPluginData(namespace: string, key: string, value: string): void;
}

interface BaseNode {
  readonly id: string;
  readonly parent: BaseNode | null;
  readonly type: string;
  readonly removed: boolean;
  getPluginData(key: string): string;
  setPluginData(key: string, value: string): void;
  getSharedPluginData(namespace: string, key: string): string;
  setSharedPluginData(namespace: string, key: string, value: string): void;
}

interface SceneNode extends BaseNode {
  readonly visible: boolean;
  readonly locked: boolean;
}

interface PageNode extends BaseNode {
  readonly type: "PAGE";
  readonly children: ReadonlyArray<SceneNode>;
}

interface ChildrenMixin {
  readonly children: ReadonlyArray<SceneNode>;
}

// Minimal node types needed for the plugin
interface RectangleNode extends SceneNode {}
interface LineNode extends SceneNode {}
interface EllipseNode extends SceneNode {}
interface PolygonNode extends SceneNode {}
interface StarNode extends SceneNode {}
interface VectorNode extends SceneNode {}
interface TextNode extends SceneNode {}
interface FrameNode extends SceneNode, ChildrenMixin {}
interface GroupNode extends SceneNode, ChildrenMixin {}
interface ComponentNode extends SceneNode, ChildrenMixin {}
interface ComponentSetNode extends SceneNode, ChildrenMixin {}
interface SliceNode extends SceneNode {}
interface StickyNode extends SceneNode {}
interface ConnectorNode extends SceneNode {}
interface ShapeWithTextNode extends SceneNode {}
interface CodeBlockNode extends SceneNode {}

interface Image {
  readonly width: number;
  readonly height: number;
}