type AcceptedAdvisory = {
	readonly id: string;
	readonly package: string;
	readonly severity: "high" | "critical";
	readonly affectedArtifacts: readonly string[];
	readonly dependencyPath: string;
	readonly reachability: string;
	readonly owner: string;
	readonly rationale: string;
	readonly expires: string;
	readonly upstream: readonly string[];
};

export type AuditPolicy = {
	readonly auditLevel: "high";
	readonly scope: string;
	readonly acceptedAdvisories: readonly AcceptedAdvisory[];
};

export type ProductionManifest = {
	readonly name: string;
	readonly version: string;
	readonly private: true;
	readonly [key: string]: unknown;
};

type Finding = {
	readonly id: string;
	readonly package: string;
	readonly severity: "high" | "critical";
	readonly title: string;
	readonly dependencyPath: string;
};

type AcceptedFinding = Finding & { readonly exception: AcceptedAdvisory };

type Evaluation = {
	readonly accepted: readonly AcceptedFinding[];
	readonly rejected: readonly Finding[];
};

export class AuditInputError extends Error {}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
	if (
		typeof value !== "string" ||
		value.trim() !== value ||
		value.length === 0
	) {
		throw new AuditInputError(`${field} must be a non-empty trimmed string`);
	}
	return value;
}

function stringArray(value: unknown, field: string): readonly string[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new AuditInputError(`${field} must be a non-empty string array`);
	}
	return value.map((item, index) => requiredString(item, `${field}[${index}]`));
}

function isPackageName(value: string): boolean {
	return /^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/i.test(value);
}

function parseResolvedNode(value: string, field: string): string {
	const separator = value.lastIndexOf("@");
	const packageName = value.slice(0, separator);
	const version = value.slice(separator + 1);
	if (
		separator < 1 ||
		!isPackageName(packageName) ||
		!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)
	) {
		throw new AuditInputError(
			`${field} must contain exact package@version nodes`,
		);
	}
	return packageName;
}

function isoDate(value: unknown, field: string): string {
	const date = requiredString(value, field);
	const parsed = new Date(`${date}T00:00:00.000Z`);
	if (
		!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
		Number.isNaN(parsed.valueOf()) ||
		parsed.toISOString().slice(0, 10) !== date
	) {
		throw new AuditInputError(`${field} must be a real YYYY-MM-DD date`);
	}
	return date;
}

function httpsUrl(value: string, field: string): string {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch (error) {
		if (error instanceof TypeError)
			throw new AuditInputError(`${field} must be a valid HTTPS URL`);
		throw error;
	}
	if (
		parsed.protocol !== "https:" ||
		parsed.username !== "" ||
		parsed.password !== "" ||
		parsed.hostname === ""
	) {
		throw new AuditInputError(`${field} must be a credential-free HTTPS URL`);
	}
	return value;
}

function parseAcceptedAdvisory(
	value: unknown,
	index: number,
	today: string,
): AcceptedAdvisory {
	if (!isRecord(value))
		throw new AuditInputError(`acceptedAdvisories[${index}] must be an object`);
	const field = (name: string): string =>
		`acceptedAdvisories[${index}].${name}`;
	const id = requiredString(value.id, field("id"));
	if (
		!/^(?:GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}|CVE-\d{4}-\d{4,})$/i.test(id)
	) {
		throw new AuditInputError(`${field("id")} must be a GHSA or CVE ID`);
	}
	const packageName = requiredString(value.package, field("package"));
	if (!isPackageName(packageName))
		throw new AuditInputError(`${field("package")} is invalid`);
	if (value.severity !== "high" && value.severity !== "critical") {
		throw new AuditInputError(`${field("severity")} must be high or critical`);
	}
	const affectedArtifacts = stringArray(
		value.affectedArtifacts,
		field("affectedArtifacts"),
	);
	if (affectedArtifacts.some((artifact) => !isPackageName(artifact))) {
		throw new AuditInputError(
			`${field("affectedArtifacts")} contains an invalid package name`,
		);
	}
	const dependencyPath = requiredString(
		value.dependencyPath,
		field("dependencyPath"),
	);
	const pathPackages = dependencyPath
		.split(" > ")
		.map((node, nodeIndex) =>
			parseResolvedNode(node, `${field("dependencyPath")}[${nodeIndex}]`),
		);
	if (pathPackages.at(-1) !== packageName) {
		throw new AuditInputError(
			`${field("dependencyPath")} must end with ${packageName}@version`,
		);
	}
	const expires = isoDate(value.expires, field("expires"));
	if (expires <= today)
		throw new AuditInputError(`${id} acceptance expired on ${expires}`);
	const upstream = stringArray(value.upstream, field("upstream")).map(
		(url, urlIndex) => httpsUrl(url, `${field("upstream")}[${urlIndex}]`),
	);
	return {
		id,
		package: packageName,
		severity: value.severity,
		affectedArtifacts,
		dependencyPath,
		reachability: requiredString(value.reachability, field("reachability")),
		owner: requiredString(value.owner, field("owner")),
		rationale: requiredString(value.rationale, field("rationale")),
		expires,
		upstream,
	};
}

export function parsePolicy(value: unknown, today: string): AuditPolicy {
	if (!isRecord(value))
		throw new AuditInputError("production audit policy must be an object");
	if (value.auditLevel !== "high")
		throw new AuditInputError(
			"production audit policy auditLevel must be high",
		);
	if (!Array.isArray(value.acceptedAdvisories)) {
		throw new AuditInputError(
			"production audit policy acceptedAdvisories must be an array",
		);
	}
	isoDate(today, "current date");
	return {
		auditLevel: "high",
		scope: requiredString(value.scope, "production audit policy scope"),
		acceptedAdvisories: value.acceptedAdvisories.map((entry, index) =>
			parseAcceptedAdvisory(entry, index, today),
		),
	};
}

function dependencyGroup(
	value: unknown,
	field: string,
): Readonly<Record<string, unknown>> | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) throw new AuditInputError(`${field} must be an object`);
	return value;
}

export function createProductionManifest(value: unknown): ProductionManifest {
	if (!isRecord(value))
		throw new AuditInputError("package manifest must be an object");
	const manifest: Record<string, unknown> & ProductionManifest = {
		name: requiredString(value.name, "package name"),
		version: requiredString(value.version, "package version"),
		private: true,
	};
	for (const group of [
		"dependencies",
		"optionalDependencies",
		"peerDependencies",
		"peerDependenciesMeta",
	] as const) {
		const dependencies = dependencyGroup(value[group], group);
		if (dependencies !== undefined) manifest[group] = dependencies;
	}
	return manifest;
}

export function resolvedDependencyPaths(
	output: string,
	artifact: string,
): readonly string[] {
	const stack: string[] = [];
	const paths = new Set<string>();
	for (const line of output.split("\n")) {
		if (line.trim() === "") continue;
		const match = /^(\s*)(?:[├└]─\s)?(.+?)(?:\s+\(requires .+\))?$/.exec(line);
		if (match === null)
			throw new AuditInputError(`unrecognized bun pm why line: ${line}`);
		const indentation = match[1]?.length ?? 0;
		const node = match[2];
		if (node === undefined)
			throw new AuditInputError(`missing package in bun pm why line: ${line}`);
		const depth = indentation === 0 ? 0 : (indentation + 1) / 3;
		if (!Number.isInteger(depth))
			throw new AuditInputError(`unrecognized bun pm why indentation: ${line}`);
		stack[depth] = node;
		stack.length = depth + 1;
		const rootNode = node.replace(/^(?:optional|peer)\s+/, "");
		if (rootNode === artifact || rootNode.startsWith(`${artifact}@`)) {
			paths.add(stack.slice(0, -1).reverse().join(" > "));
		}
	}
	return [...paths];
}

function auditEntries(value: unknown): readonly [string, readonly unknown[]][] {
	if (!isRecord(value))
		throw new AuditInputError("bun audit JSON must be an object");
	return Object.entries(value).map(([packageName, advisories]) => {
		if (!isPackageName(packageName) || !Array.isArray(advisories)) {
			throw new AuditInputError(
				"bun audit JSON contains an invalid package entry",
			);
		}
		return [packageName, advisories] as const;
	});
}

export function auditPackageNames(value: unknown): readonly string[] {
	return auditEntries(value).map(([packageName]) => packageName);
}

function parseFinding(
	value: unknown,
	packageName: string,
	dependencyPath: string,
): Finding | undefined {
	if (!isRecord(value))
		throw new AuditInputError(
			`bun audit advisory for ${packageName} must be an object`,
		);
	if (value.severity !== "high" && value.severity !== "critical")
		return undefined;
	const url = httpsUrl(
		requiredString(value.url, `${packageName} advisory URL`),
		`${packageName} advisory URL`,
	);
	const id = new URL(url).pathname.split("/").at(-1);
	if (id === undefined || id === "")
		throw new AuditInputError(`${packageName} advisory URL has no ID`);
	return {
		id,
		package: packageName,
		severity: value.severity,
		title: requiredString(value.title, `${packageName} advisory title`),
		dependencyPath,
	};
}

export function evaluateAudit(
	audit: unknown,
	policy: AuditPolicy,
	artifact: string,
	pathsByPackage: Readonly<Record<string, readonly string[]>>,
): Evaluation {
	const accepted: AcceptedFinding[] = [];
	const rejected: Finding[] = [];
	for (const [packageName, advisories] of auditEntries(audit)) {
		const resolvedPaths = pathsByPackage[packageName];
		const paths =
			resolvedPaths === undefined || resolvedPaths.length === 0
				? ["<unresolved>"]
				: resolvedPaths;
		for (const advisory of advisories) {
			for (const dependencyPath of paths) {
				const finding = parseFinding(advisory, packageName, dependencyPath);
				if (finding === undefined) continue;
				const exception = policy.acceptedAdvisories.find(
					(candidate) =>
						candidate.id === finding.id &&
						candidate.package === finding.package &&
						candidate.severity === finding.severity &&
						candidate.affectedArtifacts.includes(artifact) &&
						candidate.dependencyPath === finding.dependencyPath,
				);
				if (exception === undefined) rejected.push(finding);
				else accepted.push({ ...finding, exception });
			}
		}
	}
	return { accepted, rejected };
}
