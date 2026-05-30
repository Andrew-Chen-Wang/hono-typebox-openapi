// swift-tools-version:5.9
import PackageDescription

// Minimal SwiftPM package whose sole purpose is to GENERATE + COMPILE a client from the
// OpenAPI spec written to Sources/Client/openapi.json by the integration test.
//
// It depends only on swift-openapi-runtime (the generated client compiles against the
// ClientTransport protocol — no concrete transport such as URLSession is required), so it
// builds on Linux and macOS alike. The OpenAPIGenerator build-tool plugin runs during
// `swift build`, so a single `swift build` both generates and compiles the client.
let package = Package(
    name: "Client",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "Client", targets: ["Client"])
    ],
    dependencies: [
        // Floors set to the current releases; `from:` still allows in-range 1.x updates.
        .package(url: "https://github.com/apple/swift-openapi-generator", from: "1.12.2"),
        .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.12.0"),
    ],
    targets: [
        .target(
            name: "Client",
            dependencies: [
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime")
            ],
            plugins: [
                .plugin(name: "OpenAPIGenerator", package: "swift-openapi-generator")
            ]
        )
    ]
)
