import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	normalizePath,
} from "obsidian";
import * as path from "path";

// Define the settings interface
interface PlexWatchlistSettings {
	feedUrl: string;
	folderPath: string;
}

// Default settings
const DEFAULT_SETTINGS: PlexWatchlistSettings = {
	feedUrl: "",
	folderPath: "",
};

export default class PlexWatchlistPlugin extends Plugin {
	settings: PlexWatchlistSettings;
	interval: number;

	async onload() {
		await this.loadSettings();

		// Add a setting tab to configure the RSS feed URL and folder path
		this.addSettingTab(new PlexWatchlistSettingTab(this.app, this));

		// Initial sync on load
		this.checkFeed();

		// Periodically check the RSS feed
		this.startCheckingFeed();
	}

	onunload() {
		console.log("Unloading Plex Watchlist Plugin");
		clearInterval(this.interval);
	}

	startCheckingFeed() {
		this.interval = setInterval(() => this.checkFeed(), 3600000); // Check every hour
	}

	async checkFeed(url?: string) {
		const { feedUrl, folderPath } = this.settings;
		const currentUrl = url || feedUrl;

		if (currentUrl) {
			try {
				const response = await fetch(currentUrl);
				const text = await response.text();
				const parser = new DOMParser();
				const doc = parser.parseFromString(text, "application/xml");
				const items = doc.querySelectorAll("item");
				console.log(`Number of items in the RSS feed: ${items.length}`);

				const shows = await Promise.all(
					Array.from(items).map(async (item, index) => {
						const title =
							item.querySelector("title")?.textContent ?? "";
						const link =
							item.querySelector("link")?.textContent ?? "";
						const pubDate =
							item.querySelector("pubDate")?.textContent ?? "";
						const description =
							item.querySelector("description")?.textContent ??
							"";
						const category =
							item.querySelector("category")?.textContent ?? "";

						const thumbnail = item.querySelector(
							"media\\:thumbnail, thumbnail"
						);
						const poster = thumbnail
							? thumbnail.getAttribute("url")
							: "";

						const keywords =
							item.querySelector("media\\:keywords")
								?.textContent ?? "";
						const rating =
							item.querySelector("media\\:rating")?.textContent ??
							"";
						const guid =
							item.querySelector("guid")?.textContent ?? "";

						const year = new Date(pubDate).getFullYear();

						return {
							title,
							link,
							pubDate,
							description,
							category,
							poster,
							keywords,
							rating,
							guid,
							year,
						};
					})
				);

				await this.updateWatchlist(shows, folderPath);

				// Check for pagination
				const nextLink = doc.querySelector('link[rel="next"]');
				if (nextLink) {
					const nextUrl = nextLink.getAttribute("href");
					if (nextUrl) {
						console.log("Next URL:", nextUrl);
						await this.checkFeed(nextUrl); // Recursively fetch the next page
					}
				}
			} catch (error) {
				console.error("Error fetching or parsing RSS feed:", error);
			}
		}
	}

	async updateWatchlist(
		shows: {
			title: string;
			link: string;
			pubDate: string;
			description: string;
			category: string;
			poster: string;
			keywords: string;
			rating: string;
			guid: string;
			year: number;
		}[],
		folderPath: string
	) {
		try {
			const showsFolderPath = normalizePath(`${folderPath}/shows`);
			const moviesFolderPath = normalizePath(`${folderPath}/movies`);

			const foldersExist = await Promise.all([
				this.app.vault.adapter.exists(showsFolderPath),
				this.app.vault.adapter.exists(moviesFolderPath),
			]);

			if (!foldersExist[0]) {
				await this.app.vault.createFolder(showsFolderPath);
			}

			if (!foldersExist[1]) {
				await this.app.vault.createFolder(moviesFolderPath);
			}

			for (let index = 0; index < shows.length; index++) {
				const show = shows[index];
				const targetFolderPath =
					show.category.toLowerCase() === "movie"
						? moviesFolderPath
						: showsFolderPath;
				const filePath = normalizePath(
					`${targetFolderPath}/${show.title.replace(
						/[\/\?<>\\:\*\|":]/g,
						"_"
					)}.md`
				); // Replace illegal characters

				let file = this.app.vault.getAbstractFileByPath(
					filePath
				) as TFile;
				if (!file) {
					file = await this.app.vault.create(filePath, "");
				}

				let content = "---\n";
				content += `title: ${show.title}\n`;
				content += `link: ${show.link}\n`;
				content += `pubDate: ${show.pubDate}\n`;
				content += `description: ${show.description}\n`;
				content += `category: ${show.category}\n`;
				content += `poster: ${show.poster}\n`;
				content += `keywords: ${show.keywords}\n`;
				content += `rating: ${show.rating}\n`;
				content += `guid: ${show.guid}\n`;
				content += `year: ${show.year}\n`;
				content += "---\n";

				await this.app.vault.modify(file, content);
			}

			await this.updateWatchFile(folderPath);
		} catch (error) {
			console.error("Error updating watchlist file:", error);
		}
	}

	async updateWatchFile(folderPath: string) {
		const watchFilePath = normalizePath(`${folderPath}/watch.md`);
		let watchFile = this.app.vault.getAbstractFileByPath(
			watchFilePath
		) as TFile;
		if (!watchFile) {
			watchFile = await this.app.vault.create(watchFilePath, "");
		}

		let watchFileContent = "---\n";
		watchFileContent +=
			"cssclasses: cards, cards-cover, cards-2-3, table-max\n";
		watchFileContent += "---\n\n";
		watchFileContent += "```dataview\n";
		watchFileContent += "table without id\n";
		watchFileContent += '\t("![](" + poster + ")") as Poster,\n';
		watchFileContent += "\tfile.link as Title,\n";
		watchFileContent += "\tstring(year) as Year,\n";
		watchFileContent += '\tpubDate as "Date Added"\n';
		watchFileContent += 'from "plex/movies"\n';
		watchFileContent += "sort pubDate desc, title asc\n";
		watchFileContent += "```\n";

		await this.app.vault.modify(watchFile, watchFileContent);
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class PlexWatchlistSettingTab extends PluginSettingTab {
	plugin: PlexWatchlistPlugin;

	constructor(app: App, plugin: PlexWatchlistPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		containerEl.createEl("h2", { text: "Plex Watchlist Settings" });

		new Setting(containerEl)
			.setName("RSS Feed URL")
			.setDesc("Paste your Plex RSS feed URL here.")
			.addText((text) =>
				text
					.setPlaceholder("Enter URL")
					.setValue(this.plugin.settings.feedUrl)
					.onChange(async (value) => {
						this.plugin.settings.feedUrl = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Folder Path")
			.setDesc("Enter the folder path where watch.md will be saved.")
			.addText((text) =>
				text
					.setPlaceholder("Enter folder path")
					.setValue(this.plugin.settings.folderPath)
					.onChange(async (value) => {
						this.plugin.settings.folderPath = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).addButton((button) => {
			button
				.setButtonText("Sync Now")
				.setCta()
				.onClick(async () => {
					await this.plugin.checkFeed();
					new Notice("Plex Watchlist synced successfully.");
				});
		});
	}
}
