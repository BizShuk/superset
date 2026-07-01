module.exports = {
    apps: [
        // agy-superset (planner)
        {
            name: "agy-superset-system",
            script: "agy",
            args: [
                "--add-dir",
                "/Users/shuk/projects/tmp/superset",
                "-p",
                "'run /system-planner'"
            ],
            namespace: "planner",
            cwd: "/Users/shuk/projects/tmp/superset",
            instances: 1,
            cron: "50 0-9 * * *"
        }
    ]
};
