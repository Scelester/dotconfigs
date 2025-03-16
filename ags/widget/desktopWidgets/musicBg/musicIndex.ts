// @ts-nocheck no-undef
const { Gio, GLib } = imports.gi;

export const musicBG = () => {
    let songTitle = Variable("... No Song Playing");
    let isPlaying = Variable(false);
    let playIcon = Variable("media-playback-start-symbolic");
    const downloadState = Variable('idle');
    let currentOnlineTitle = null;
    let currentOnlineId = null;

    // Variable to hold the search overlay reference for toggling
    let searchOverlay = null;

    const handleKeyPress = (self, event) => {
        if (event.get_keyval()[1] === imports.gi.Gdk.KEY_Escape) {
            self.destroy();
        }
    };

    const updateSongTitle = async () => {
        try {
            let statusOutput = await Utils.execAsync("mpc status");
            let isPlayingNow = statusOutput.includes("[playing]");
            let lines = statusOutput.trim().split("\n");
            let mpcTitle;
            if (lines.length === 0 || !isPlayingNow) {
                mpcTitle = "... No Song Playing";
            } else {
                mpcTitle = lines[0];
            }
            let titleToShow = currentOnlineTitle ? currentOnlineTitle : mpcTitle;
            songTitle.setValue(titleToShow);
            isPlaying.setValue(isPlayingNow);
            playIcon.setValue(
                isPlayingNow
                    ? "media-playback-pause-symbolic"
                    : "media-playback-start-symbolic"
            );
        } catch (error) {
            songTitle.setValue("... No Song Playing");
        }
    };

    const togglePlayPause = async () => {
        await Utils.execAsync("mpc toggle");
        updateSongTitle();
    };

    const openSearchOverlay = () => {
        // If the overlay is already open, destroy it to toggle off.
        if (searchOverlay) {
            searchOverlay.destroy();
            searchOverlay = null;
            return;
        }

        let resultsContainer = Widget.Box({
            class_name: "search-results",
            vertical: true,
            spacing: 10,
            children: []
        });

        let searchEntry = Widget.Entry({
            class_name: "search-entry",
            placeholder_text: "Search for music...",
            onAccept: async (entry) => {
                try {
                    let query = entry.get_text().trim();
                    if (!query) return;

                    // Local Music Section
                    let localOutput = await Utils.execAsync("find /home/scelester/Music/ -type f");
                    let localFiles = localOutput.trim().split("\n").filter(f => f.length > 0);
                    let matchingFiles = localFiles.filter(file =>
                        file.toLowerCase().includes(query.toLowerCase())
                    ).slice(0, 5);

                    let localListItems = matchingFiles.map(file => {
                        let fileName = file.split("/").pop();
                        return Widget.Button({
                            class_name: "search-item",
                            label: fileName,
                            on_clicked: async () => {
                                currentOnlineTitle = null;
                                currentOnlineId = null;
                                await Utils.execAsync(`mpc add "${fileName}"`);
                                const playlistInfo = await Utils.execAsync("mpc playlist");
                                const playlistLength = playlistInfo.trim().split("\n").length;
                                await Utils.execAsync(`mpc play ${playlistLength}`);
                                updateSongTitle();
                                searchOverlay.destroy();
                            }
                        });
                    });

                    // Online Music Section
                    let onlineCmd = `yt-dlp "ytsearch5:${query}" --flat-playlist --skip-download --quiet --get-title --get-id`;
                    let onlineOutput = await Utils.execAsync(onlineCmd);
                    let onlineLines = onlineOutput.trim().split("\n").filter(l => l.length > 0);
                    let onlineResults = [];
                    for (let i = 0; i < onlineLines.length; i += 2) {
                        let title = onlineLines[i];
                        let id = onlineLines[i + 1];
                        onlineResults.push({ title, id });
                    }
                    let onlineListItems = onlineResults.map(item =>
                        Widget.Button({
                            class_name: "search-item",
                            label: item.title,
                            on_clicked: async () => {
                                try {
                                    let url = `https://www.youtube.com/watch?v=${item.id}`;
                                    // Tweaked yt-dlp arguments for faster URL extraction.
                                    let audioUrl = await Utils.execAsync(`yt-dlp -f bestaudio -g --no-warnings --no-check-certificate --force-ipv4 "${url}"`);
                                    await Utils.execAsync("mpc clear");
                                    await Utils.execAsync(`mpc add "${audioUrl.trim()}"`);
                                    await Utils.execAsync("mpc play");
                                    currentOnlineTitle = item.title;
                                    currentOnlineId = item.id;
                                    songTitle.setValue(item.title);
                                    isPlaying.setValue(true);
                                    playIcon.setValue("media-playback-pause-symbolic");
                                    searchOverlay.destroy();
                                } catch (err) {
                                    log("Error playing online file: " + err);
                                }
                            }
                        })
                    );

                    // Update results container
                    resultsContainer.children = [
                        Widget.Box({
                            vertical: true,
                            spacing: 5,
                            children: [
                                Widget.Label({
                                    class_name: "search-section-label",
                                    label: "Local Music"
                                }),
                                Widget.Box({ vertical: true, children: localListItems })
                            ]
                        }),
                        Widget.Box({
                            vertical: true,
                            spacing: 5,
                            children: [
                                Widget.Label({
                                    class_name: "search-section-label",
                                    label: "Online Music"
                                }),
                                Widget.Box({ vertical: true, children: onlineListItems })
                            ]
                        }),
                        Widget.Button({
                            class_name: "close-btn",
                            label: "Close",
                            on_clicked: () => searchOverlay.destroy()
                        })
                    ];
                } catch (error) {
                    log("Error in search onAccept: " + error);
                }
            }
        });

        searchOverlay = Widget.Window({
            class_name: "search-overlay",
            name: "search-overlay",
            modal: true,
            keymode: "on-demand",
            anchor: ["bottom"],
            margins: [90, 0],
            layer: "background",
            visible: true,
            child: Widget.Box({
                vertical: true,
                spacing: 10,
                children: [
                    searchEntry,
                    resultsContainer
                ]
            }),
            setup: self => {
                setTimeout(() => {
                    searchEntry.grab_focus();
                }, 50);
                self.connect("key-press-event", (window, event) => handleKeyPress(self, event));
                self.connect("destroy", () => { searchOverlay = null; });
            }
        });
    };

    const openLyricsOverlay = () => {
        let overlay = Widget.Window({
            class_name: "lyrics-overlay",
            name: "lyrics-overlay",
            anchor: ["bottom"],
            margins: [90, 0],
            modal: true,
            keymode: "on-demand",
            layer: "background",
            visible: true,
            setup: self => {
                self.connect("key-press-event", (window, event) => handleKeyPress(self, event));
            },
            child: Widget.Box({
                vertical: true,
                spacing: 10,
                children: [
                    Widget.Label({
                        class_name: "lyrics-text",
                        wrap: true,
                        label: "Lyrics feature is not implemented yet."
                    }),
                    Widget.Button({
                        class_name: "close-btn",
                        label: "Close",
                        on_clicked: () => overlay.destroy()
                    })
                ]
            })
        });
    };

    const downloadButton = Widget.Button({
        class_name: "music-btn",
        setup: (self) => {
            self.visible = !!currentOnlineId;
            songTitle.connect('changed', () => {
                self.visible = !!currentOnlineId;
            });
        },
        cursor: "pointer",
        child: Widget.Icon({
            icon: "download-symbolic",
            size: 30,
        }).bind('icon', downloadState.bind().as(value => {
            if (value === 'loading') return 'system-reboot-symbolic';
            if (value === 'downloaded') return 'process-completed-symbolic';
            return "download-symbolic";
        })),
        on_clicked: async () => {
            if (!currentOnlineId) return;
            try {
                // Set download state to loading immediately.
                downloadState.setValue('loading');

                const downloadPath = GLib.get_home_dir() + "/Music/";
                const downloadDir = Gio.File.new_for_path(downloadPath);
                if (!downloadDir.query_exists(null)) {
                    downloadDir.make_directory_with_parents(null);
                }
                const url = `https://www.youtube.com/watch?v=${currentOnlineId}`;
                const filenameTemplate = `${downloadPath}%(title)s.%(ext)s`;

                const downloadedFilename = await Utils.execAsync(
                    `yt-dlp --get-filename -o '${filenameTemplate}' "${url}"`
                );
                const trimmedFilename = downloadedFilename.trim();
                const file = Gio.File.new_for_path(trimmedFilename);
                if (file.query_exists(null)) {
                    downloadState.setValue("downloaded");
                    Utils.notify({
                        summary: "Already Downloaded",
                        body: `File already exists: ${currentOnlineTitle}`,
                    });
                    await Utils.execAsync(`mpc update`);
                    return;
                }
                // Download file
                const downloadCmd = `yt-dlp -x --audio-format mp3 -o '${filenameTemplate}' "${url}"`;
                await Utils.execAsync(downloadCmd);

                await Utils.execAsync(`mpc update`);
                downloadState.setValue('downloaded');
                Utils.notify({
                    summary: "Download Complete",
                    body: `Downloaded and added to playlist: ${currentOnlineTitle}`,
                });
            } catch (error) {
                log("Download error: " + error);
                downloadState.setValue('idle');
            }
        }
    });

    const idleLoop = async () => {
        try {
            await Utils.execAsync("mpc idle");
            updateSongTitle();
        } catch (error) {
            // Optionally log error
        } finally {
            idleLoop();
        }
    };

    updateSongTitle();
    idleLoop();
    Object.assign(globalThis, { openSearchOverlay });

    return Widget.EventBox({
        class_name: "music-bg",
        child: Widget.Box({
            vertical: false,
            class_name: "music-box-container",
            hexpand: true,
            spacing: 15,
            children: [
                Widget.Button({
                    class_name: "music-btn",
                    on_clicked: async () => {
                        await Utils.execAsync("mpc prev");
                        updateSongTitle();
                    },
                    child: Widget.Icon("media-skip-backward-symbolic")
                }),
                Widget.Button({
                    class_name: "music-btn play",
                    on_clicked: togglePlayPause,
                    child: Widget.Icon({ icon: playIcon.bind() })
                }),
                Widget.Button({
                    class_name: "music-btn",
                    on_clicked: async () => {
                        await Utils.execAsync("mpc next");
                        updateSongTitle();
                    },
                    child: Widget.Icon("media-skip-forward-symbolic")
                }),
                Widget.Label({
                    class_name: "music-title",
                    truncate: 'end',
                    maxWidthChars: 100,
                    useMarkup: true,
                    label: songTitle.bind()
                }),
                Widget.Label({
                    hexpand: true,
                    label: ""
                }),
                Widget.Button({
                    class_name: "music-btn",
                    cursor: "pointer",
                    on_clicked: openSearchOverlay,
                    child: Widget.Icon("system-search-symbolic")
                }),
                Widget.Button({
                    class_name: "music-btn",
                    on_clicked: openLyricsOverlay,
                    cursor: "pointer",
                    child: Widget.Icon({
                        icon: "/home/scelester/.config/ags/assets/music-lyric-2-svgrepo-com.svg",
                        css: "color: #ffffff; font-size: 25px;"
                    })
                }),
                downloadButton,
            ]
        })
    });
};

export default musicBG;
