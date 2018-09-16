import { EntrySchema } from "@netrunner/registry-log";
import { Hypercore, HypercoreStreamOptions } from "hypercore";
import { RegistryWriter } from './RegistryWriter';
import { RegistryDatabase } from './RegistryDatabase';
import { writable, removable } from "./util";
import { Readable } from "stream";

export interface RegistryFeedOptions extends HypercoreStreamOptions {
    throws?: boolean;
}

export class RegistryFeed {
    public writer!: RegistryWriter;
    private feeds!: Map<Hypercore<EntrySchema>, Readable>;
    private isReady: boolean = false;

    constructor(
        feeds: Hypercore<EntrySchema>[],
        private db: RegistryDatabase,
        private options: RegistryFeedOptions = {}
    ) {
        if (!options) {
            options = { live: true };
        }
        this.addFeeds(feeds);
    }

    public async ready(): Promise<void> {
        if (!this.isReady) {
            const promises = [];
            for (const feed of this.feeds.keys()) {
                promises.push(this.feedReady(feed));
            }
            await Promise.all(promises);
            this.isReady = true;
        }
    }

    public async create(entry: EntrySchema): Promise<void> {
        await this.ready();
        this.throwsIfFeedNotWritable();
        await this.writer.create(entry);
    }

    public async update(entry: EntrySchema): Promise<void> {
        await this.ready();
        this.throwsIfFeedNotWritable();
        await this.writer.update(entry);
    }

    public async remove(entry: EntrySchema): Promise<void> {
        await this.ready();
        this.throwsIfFeedNotWritable();
        await this.writer.remove(entry);
    }

    public addFeed(feed: Hypercore<EntrySchema>): void {
        if (!this.feeds.has(feed)) {
            this.feeds.set(feed, feed.createReadStream(this.options).on("data", async (entry: EntrySchema) => {
                const registered = await this.db.get(entry.name);
                if (writable(entry, registered)) {
                    await this.db.put(entry.name, entry);
                }
                else if (removable(entry, registered)) {
                    await this.db.del(entry.name);
                }
            }));
        }
    }

    public addFeeds(feeds: Hypercore<EntrySchema>[]) {
        if (!this.feeds) {
            this.feeds = new Map();
        }
        for (const feed of feeds) {
            this.addFeed(feed);
        }
    }

    public removeFeed(feed: Hypercore<EntrySchema>) {
        if (this.feeds && this.feeds.has(feed)) {
            const readable = this.feeds.get(feed);
            if (readable) {
                readable.destroy();
            }
            this.feeds.delete(feed);
        }
    }

    public removeFeeds(feeds: Hypercore<EntrySchema>[]) {
        if (!this.feeds) {
            this.feeds = new Map();
        }
        for (const feed of feeds) {
            this.removeFeed(feed);
        }
    }

    private throwsIfFeedNotWritable() {
        if (!this.writer) {
            throw new Error("No writable feed available.");
        }
    }

    private feedReady(feed: Hypercore<EntrySchema>): Promise<void> {
        return new Promise((resolve, reject) => {
            feed.ready(err => {
                if (err && this.options.throws) return reject(err);
                if (feed.writable && !this.writer) {
                    this.writer = new RegistryWriter(feed, this.db);
                }
                resolve();
            });
        });
    }

}

export function createRegistryFeed(feeds: Hypercore<EntrySchema>[], db: RegistryDatabase, options: RegistryFeedOptions = {}) {
    return new RegistryFeed(feeds, db, options);
}
